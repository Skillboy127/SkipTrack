"""Checks gunicorn.conf.py keeps query strings (which carry reward tokens) out of the access log.

    python test_gunicorn_conf.py

gunicorn itself is not imported (it needs a POSIX system); this reads the config the way
gunicorn does, by executing the file, and checks the format string it sets.
"""
import pathlib
import re
import sys

config = {}
exec(pathlib.Path(__file__).with_name("gunicorn.conf.py").read_text(encoding="utf-8"), config)
fmt = config.get("access_log_format", "")

problems = []
if not fmt:
    problems.append("gunicorn.conf.py does not set access_log_format")
# %(r)s is the whole request line, %(q)s the query, %(f)s the referer, %(U)s... is only the path.
for atom in ("r", "q", "f"):
    if re.search(rf"%\({atom}\)s", fmt):
        problems.append(f"access_log_format logs %({atom})s, which can contain the query string")
if "%(U)s" not in fmt:
    problems.append("access_log_format should log the path with %(U)s")

for problem in problems:
    print("FAIL  " + problem)
if problems:
    sys.exit(1)
print("PASS  access log format has no query string: " + fmt)
