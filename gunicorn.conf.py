# Loaded automatically by gunicorn (it reads ./gunicorn.conf.py), so it applies whatever
# the Render start command is.
#
# If access logging is on, keep the query string out of it. gunicorn's default format
# logs the whole request line ("%(r)s"), and /reward/callback's query carries the
# one-time reward token (custom_data). %(U)s is the path only.
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(m)s %(U)s" %(s)s %(b)s "%(a)s"'
