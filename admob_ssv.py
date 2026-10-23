"""Verification of AdMob rewarded-ad server-side verification (SSV) callbacks.

Follows Google's SSV documentation:
https://developers.google.com/admob/android/ssv

* The callback is a GET whose query string ends with ``signature=...&key_id=...``
  (always the last two parameters, in that order).
* The signed content is the raw query string, exactly as received, up to but not
  including the ``&`` before ``signature=``. It is never parsed, decoded, re-encoded
  or reordered: this module works on the raw BYTES from the WSGI QUERY_STRING and
  slices them by position, so what is verified is what was sent.
* The signature is ECDSA over SHA-256, DER encoded, base64 with the URL-safe
  alphabet and no padding (padding is restored before decoding).
* Public keys come from Google's published verifier-keys JSON, matched on key_id.
  They rotate, so they are cached for at most 24 hours and re-fetched (rate
  limited) when an unknown key_id shows up.

Nothing here logs request parameters: they contain the one-time reward token.
Rejections carry only a short category (see InvalidCallback.reason), plus for a
signature failure a few lengths and yes/no facts about the request (never its
content), so callers can log why a callback was refused.
"""
import base64
import binascii
import json
import re
import string
import threading
import time
import urllib.request
from urllib.parse import parse_qsl, unquote_to_bytes

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
_PERCENT_TRIPLET = re.compile(rb'%[0-9A-Fa-f]{2}')
_PARAM_NAME = re.compile(rb'\A[A-Za-z0-9_.\-]{1,40}\Z')
_PUNCTUATION = frozenset(string.punctuation.encode('ascii'))
_SHAPE_MAX_CHARS = 1000
_NAMES_MAX = 40

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

    ``debug`` is, for signature failures, a dict of lengths and booleans describing the
    request (never any of its content), for temporary diagnostics.
    """

    def __init__(self, reason: str = 'other', debug: dict | None = None):
        super().__init__(reason)
        self.reason = reason
        self.debug = debug


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


def _mask_value(value: bytes) -> str:
    """A value with every letter and digit replaced by 'x'.

    Percent-encoded triplets (%2f, %2F) are kept exactly as received, and so is other
    ASCII punctuation; anything else (control characters, spaces, non-ASCII bytes)
    becomes '?', so the result is always plain printable text that can't break a log line.
    """
    out = []
    i = 0
    while i < len(value):
        if _PERCENT_TRIPLET.match(value, i):
            out.append(value[i:i + 3].decode('ascii'))
            i += 3
            continue
        byte = value[i]
        if 0x30 <= byte <= 0x39 or 0x41 <= byte <= 0x5A or 0x61 <= byte <= 0x7A:
            out.append('x')
        elif byte in _PUNCTUATION:
            out.append(chr(byte))
        else:
            out.append('?')
        i += 1
    return ''.join(out)


def describe_shape(raw: bytes) -> tuple[str, str]:
    """(shape, names) of a raw query string, revealing the structure but none of the values.

    ``shape`` is the query with parameter names and separators as they are and every value
    masked (see _mask_value), so the order, the encoding style and the upper/lower case of
    percent escapes are visible. ``names`` is the parameter names in order, comma separated.
    A name that isn't a plain identifier is masked like a value. Both are length-limited.
    """
    shape_parts = []
    names = []
    for part in raw.split(b'&'):
        name, equals, value = part.partition(b'=')
        if _PARAM_NAME.match(name):
            shown_name = name.decode('ascii')
            names.append(shown_name)
        else:
            shown_name = _mask_value(name)
            names.append('invalid')
        shape_parts.append(shown_name + equals.decode('ascii') + _mask_value(value))
    shape = '&'.join(shape_parts)
    if len(shape) > _SHAPE_MAX_CHARS:
        shape = shape[:_SHAPE_MAX_CHARS] + '...'
    names_text = ','.join(names[:_NAMES_MAX]) + ('...' if len(names) > _NAMES_MAX else '')
    return shape, names_text


def _debug_facts(raw: bytes, signed_content: bytes, signature_b64: bytes, signature: bytes | None) -> dict:
    """Lengths, yes/no facts, and a masked outline of the request: none of its values."""
    shape, names = describe_shape(raw)
    return {
        'content_len': len(signed_content),
        'sig_b64_len': len(signature_b64),
        'sig_len': len(signature) if signature is not None else -1,
        # DER ECDSA signatures are a SEQUENCE (0x30); a raw r||s signature is not.
        'sig_der_prefix': bool(signature) and signature[0] == 0x30,
        'raw_has_percent': b'%' in raw,
        'content_non_ascii': any(byte > 127 for byte in signed_content),
        'shape': shape,
        'names': names,
    }


def verify_callback(query_string: bytes | str, now: float | None = None) -> dict[str, str]:
    """Verify a raw SSV query string and return its parameters.

    ``query_string`` should be the raw bytes as received (``request.query_string``).
    Raises InvalidCallback if anything is off, KeysUnavailable if Google's keys
    can't be obtained. The returned dict has no ``signature`` or ``key_id``.
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

    try:
        signature = _b64url_decode(signature_b64)
    except InvalidCallback as exc:
        raise InvalidCallback('bad_signature', _debug_facts(raw, signed_content, signature_b64, None)) from exc

    public_key = _public_key_for(key_id)
    try:
        public_key.verify(signature, signed_content, ec.ECDSA(hashes.SHA256()))
    except _CryptoInvalidSignature as exc:
        raise InvalidCallback('bad_signature', _debug_facts(raw, signed_content, signature_b64, signature)) from exc

    # Only now, with the signature proven, are the parameters read (the verified
    # bytes themselves are never altered).
    pairs = parse_qsl(signed_content.decode('utf-8', 'replace'), keep_blank_values=True)
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
