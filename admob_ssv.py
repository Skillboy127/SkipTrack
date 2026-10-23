"""Verification of AdMob rewarded-ad server-side verification (SSV) callbacks.

Follows Google's SSV documentation:
https://developers.google.com/admob/android/ssv

* The callback is a GET whose query string ends with ``signature=...&key_id=...``
  (always the last two parameters, in that order).
* The signed content is the query string up to, but not including, the ``&`` before
  ``signature=``. Google signs it PERCENT-DECODED (``reward_item=Imports%20Rewarded``
  on the wire is signed as ``reward_item=Imports Rewarded``): found by checking a
  real AdMob "Verify URL" request against Google's production key, which verifies
  only over the decoded form. So the signature is checked against that decoded form
  and, failing that, against the bytes exactly as received. Both are derived from the
  request by fixed rules and both need Google's private key to satisfy, so accepting
  either lets nothing extra through.
* This module works on the raw BYTES from the WSGI QUERY_STRING and slices them by
  position (never from request.args, never reordered or re-encoded).
* The signature is ECDSA over SHA-256, DER encoded, base64 with the URL-safe
  alphabet and no padding (padding is restored before decoding).
* Public keys come from Google's published verifier-keys JSON, matched on key_id.
  They rotate, so they are cached for at most 24 hours and re-fetched (rate
  limited) when an unknown key_id shows up.

Nothing here logs request parameters: they contain the one-time reward token.
Rejections carry only a short category (see InvalidCallback.reason), so callers
can log why a callback was refused without logging anything from the request.
"""
import base64
import binascii
import json
import re
import threading
import time
import urllib.request
from urllib.parse import unquote_to_bytes

from cryptography.exceptions import InvalidSignature as _CryptoInvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json'
KEY_CACHE_SECONDS = 12 * 3600      # Google asks for no more than 24h
KEY_REFRESH_MIN_SECONDS = 60       # don't hammer Google if someone sends junk key_ids
CALLBACK_MAX_AGE_SECONDS = 30 * 60  # the reward timestamp must be recent

_SIGNATURE_MARKER = b'&signature='
_SIGNATURE_TAIL = re.compile(rb'\Asignature=([^&]+)&key_id=([^&]+)\Z')
_KEY_ID_PARAM = re.compile(rb'(?:\A|&)key_id=([^&]*)')
_NUMERIC_KEY_ID = re.compile(rb'\A\d{1,20}\Z')

_lock = threading.Lock()
_keys: dict[str, str] = {}   # key_id -> PEM
_fetched_at = 0.0
_last_refresh_attempt = 0.0


class InvalidCallback(Exception):
    """The callback is malformed, stale, or its signature does not verify.

    ``reason`` is a fixed category that is safe to log:
      missing_params   no signature/key_id in the required position, or no usable timestamp
      unknown_key_id   the key_id is not in Google's published list (even after a refresh)
      bad_signature    the signature is undecodable or does not match the content
      stale_timestamp  validly signed, but the reward time is too far from now
      other            anything else
    """

    def __init__(self, reason: str = 'other'):
        super().__init__(reason)
        self.reason = reason


def _as_bytes(query_string: bytes | str) -> bytes:
    return query_string if isinstance(query_string, bytes) else query_string.encode('utf-8')


def loggable_key_id(query_string: bytes | str) -> str:
    """The key_id from a raw query string, only if it looks like one (digits), for logging.

    Key ids are public identifiers, not secrets, but they come from the requester,
    so anything that is not a short number is reported as 'invalid' rather than echoed.
    """
    match = _KEY_ID_PARAM.search(_as_bytes(query_string))
    if not match:
        return 'none'
    value = unquote_to_bytes(match.group(1))
    return value.decode('ascii') if _NUMERIC_KEY_ID.match(value) else 'invalid'


class KeysUnavailable(Exception):
    """Google's verifier keys could not be fetched (callers should answer 503 so AdMob retries)."""


def _pem_from_entry(entry: dict) -> str:
    """A PEM public key from one entry of Google's list (it has ``pem`` and ``base64``, the latter a DER SubjectPublicKeyInfo)."""
    if entry.get('pem'):
        return entry['pem']
    der = base64.b64decode(entry['base64'])
    body = base64.b64encode(der).decode('ascii')
    lines = [body[i:i + 64] for i in range(0, len(body), 64)]
    return '-----BEGIN PUBLIC KEY-----\n' + '\n'.join(lines) + '\n-----END PUBLIC KEY-----\n'


def _fetch_keys() -> dict[str, str]:
    try:
        with urllib.request.urlopen(KEYS_URL, timeout=5) as response:  # noqa: S310 - fixed https URL
            payload = json.loads(response.read().decode('utf-8'))
        return {str(entry['keyId']): _pem_from_entry(entry) for entry in payload['keys']}
    except Exception as exc:  # network, JSON or schema problems all mean "can't verify right now"
        raise KeysUnavailable(type(exc).__name__) from exc


def _public_key_for(key_id: str):
    """The public key for ``key_id``, refreshing Google's list when the cache may be stale.

    A key_id that is not in the cache triggers one re-fetch of the list before it is
    rejected as unknown (Google rotates keys, so the cache can be behind). Re-fetches
    are limited to one per KEY_REFRESH_MIN_SECONDS, so a stream of junk key_ids can't
    turn into a stream of requests to Google; a list fetched moments ago is not stale.
    """
    global _keys, _fetched_at, _last_refresh_attempt
    now = time.time()
    with _lock:
        stale = now - _fetched_at > KEY_CACHE_SECONDS
        unknown = key_id not in _keys
        can_refresh = now - _last_refresh_attempt > KEY_REFRESH_MIN_SECONDS
        if (stale or unknown) and (can_refresh or not _keys):
            _last_refresh_attempt = now
            try:
                _keys = _fetch_keys()
                _fetched_at = now
            except KeysUnavailable:
                if not _keys:
                    raise  # nothing cached to fall back on
        pem = _keys.get(key_id)
    if pem is None:
        raise InvalidCallback('unknown_key_id')
    key = serialization.load_pem_public_key(pem.encode('utf-8'))
    if not isinstance(key, ec.EllipticCurvePublicKey):
        raise InvalidCallback('bad_signature')
    return key


def _b64url_decode(value: bytes) -> bytes:
    """Decode base64 with the URL-safe alphabet; padding is optional (and restored here)."""
    value = value.rstrip(b'=')
    try:
        return base64.urlsafe_b64decode(value + b'=' * (-len(value) % 4))
    except (binascii.Error, ValueError) as exc:
        raise InvalidCallback('bad_signature') from exc


def verify_callback(query_string: bytes | str, now: float | None = None) -> dict[str, str]:
    """Verify a raw SSV query string and return its parameters.

    ``query_string`` should be the raw bytes as received (``request.query_string``).
    Raises InvalidCallback if anything is off, KeysUnavailable if Google's keys
    can't be obtained. The returned dict has no ``signature`` or ``key_id``.

    The parameters returned are those the request carried: each name and value of the
    raw string percent-decoded on its own (so an encoded ``&`` stays part of its value).
    """
    raw = _as_bytes(query_string)

    # signature and key_id are the last two parameters: slice by position, from the end.
    marker = raw.rfind(_SIGNATURE_MARKER)
    if marker < 0:
        raise InvalidCallback('missing_params')
    signed_content = raw[:marker]
    tail = _SIGNATURE_TAIL.match(raw[marker + 1:])
    if not tail:
        raise InvalidCallback('missing_params')
    signature_b64 = unquote_to_bytes(tail.group(1))
    key_id = unquote_to_bytes(tail.group(2)).decode('ascii', 'replace')

    signature = _b64url_decode(signature_b64)

    public_key = _public_key_for(key_id)

    # What Google signed: the percent-decoded query. The bytes as received are tried
    # second, in case a request was signed in that form.
    decoded_content = unquote_to_bytes(signed_content)
    candidates = [decoded_content] if decoded_content == signed_content else [decoded_content, signed_content]
    for candidate in candidates:
        try:
            public_key.verify(signature, candidate, ec.ECDSA(hashes.SHA256()))
            break
        except _CryptoInvalidSignature:
            continue
    else:
        raise InvalidCallback('bad_signature')

    # Only now, with the signature proven, are the parameters read. Each name and
    # value is decoded separately, so an encoded '&' or '=' can't change which
    # parameter a value belongs to.
    params: dict[str, str] = {}
    for part in signed_content.split(b'&'):
        name_bytes, _, value_bytes = part.partition(b'=')
        name = unquote_to_bytes(name_bytes).decode('utf-8', 'replace')
        if name in params:
            raise InvalidCallback('missing_params')
        params[name] = unquote_to_bytes(value_bytes).decode('utf-8', 'replace')

    try:
        reward_time = int(params['timestamp']) / 1000.0
    except (KeyError, ValueError) as exc:
        raise InvalidCallback('missing_params') from exc
    if abs((now if now is not None else time.time()) - reward_time) > CALLBACK_MAX_AGE_SECONDS:
        raise InvalidCallback('stale_timestamp')

    return params
