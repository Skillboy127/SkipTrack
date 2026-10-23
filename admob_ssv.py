"""Verification of AdMob rewarded-ad server-side verification (SSV) callbacks.

Follows Google's SSV documentation:
https://developers.google.com/admob/android/ssv

* The callback is a GET whose query string ends with ``signature=...&key_id=...``
  (always last, in that order).
* The signed content is the raw query string up to, but not including, the ``&``
  before ``signature=``. It must not be re-ordered or re-encoded, so this module
  works from the raw string, never from a parsed-and-rebuilt one.
* The signature is ECDSA over SHA-256, DER encoded, base64 (URL-safe alphabet).
* Public keys come from Google's published verifier-keys JSON, matched on key_id.
  They rotate, so they are cached for at most 24 hours and re-fetched (rate
  limited) when an unknown key_id shows up.

Nothing here logs request parameters: they contain the one-time reward token.
Rejections carry only a short category (see InvalidCallback.reason) so callers can
log why a callback was refused without logging anything from the request itself.
"""
import base64
import binascii
import json
import re
import threading
import time
import urllib.request
from urllib.parse import parse_qsl, unquote

from cryptography.exceptions import InvalidSignature as _CryptoInvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json'
KEY_CACHE_SECONDS = 12 * 3600      # Google asks for no more than 24h
KEY_REFRESH_MIN_SECONDS = 60       # don't hammer Google if someone sends junk key_ids
CALLBACK_MAX_AGE_SECONDS = 30 * 60  # the reward timestamp must be recent

_SIGNATURE_TAIL = re.compile(r'^signature=([^&]+)&key_id=([^&]+)$')
_KEY_ID_PARAM = re.compile(r'(?:^|&)key_id=([^&]*)')
_NUMERIC_KEY_ID = re.compile(r'^\d{1,20}$')

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


def loggable_key_id(query_string: str) -> str:
    """The key_id from a raw query string, only if it looks like one (digits), for logging.

    Key ids are public identifiers, not secrets, but they come from the requester,
    so anything that is not a short number is reported as 'invalid' rather than echoed.
    """
    match = _KEY_ID_PARAM.search(query_string)
    if not match:
        return 'none'
    value = unquote(match.group(1))
    return value if _NUMERIC_KEY_ID.match(value) else 'invalid'


class KeysUnavailable(Exception):
    """Google's verifier keys could not be fetched (callers should answer 503 so AdMob retries)."""


def _fetch_keys() -> dict[str, str]:
    try:
        with urllib.request.urlopen(KEYS_URL, timeout=5) as response:  # noqa: S310 - fixed https URL
            payload = json.loads(response.read().decode('utf-8'))
        return {str(entry['keyId']): entry['pem'] for entry in payload['keys']}
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


def _b64url_decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    except (binascii.Error, ValueError) as exc:
        raise InvalidCallback('bad_signature') from exc


def verify_callback(query_string: str, now: float | None = None) -> dict[str, str]:
    """Verify a raw SSV query string and return its parameters.

    Raises InvalidCallback if anything is off, KeysUnavailable if Google's keys
    can't be obtained. The returned dict has no ``signature`` or ``key_id``.
    """
    marker = query_string.find('&signature=')
    if marker < 0:
        raise InvalidCallback('missing_params')
    signed_content = query_string[:marker]
    tail = _SIGNATURE_TAIL.match(query_string[marker + 1:])
    if not tail:
        raise InvalidCallback('missing_params')
    signature = _b64url_decode(unquote(tail.group(1)))
    key_id = unquote(tail.group(2))

    public_key = _public_key_for(key_id)
    try:
        public_key.verify(signature, signed_content.encode('utf-8'), ec.ECDSA(hashes.SHA256()))
    except _CryptoInvalidSignature as exc:
        raise InvalidCallback('bad_signature') from exc

    pairs = parse_qsl(signed_content, keep_blank_values=True)
    params: dict[str, str] = {}
    for name, value in pairs:
        if name in params:
            raise InvalidCallback('missing_params')
        params[name] = value

    try:
        reward_time = int(params['timestamp']) / 1000.0
    except (KeyError, ValueError) as exc:
        raise InvalidCallback('missing_params') from exc
    if abs((now if now is not None else time.time()) - reward_time) > CALLBACK_MAX_AGE_SECONDS:
        raise InvalidCallback('stale_timestamp')

    return params
