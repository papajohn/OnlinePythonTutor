#!/usr/bin/python3

# Minimal CGI script for Online Python Tutor (v3), tested under Python 2 and 3

# If you want to run this script, then you'll need to change the
# shebang #! line at the top of this file to point to your system's Python.
#
# Also, check CGI execute permission in your script directory.
# You might need to create an .htaccess file like the following:
#
#   Options +ExecCGI
#   AddHandler cgi-script .py


import cgi
import json
import pg_logger
import sys


# set to true if you want to log queries in DB_FILE
LOG_QUERIES = True

if LOG_QUERIES:
  import os, datetime, create_log_db


def cgi_finalizer(input_code, output_trace):
  """Write JSON output for js/pytutor.js as a CGI result."""
  ret = dict(code=input_code, trace=output_trace)
  json_output = json.dumps(ret, indent=None) # use indent=None for most compact repr

  if LOG_QUERIES:
    # just to be paranoid, don't croak the whole program just
    # because there's some error in logging it to the database
    try:
      # log queries into sqlite database.
      # make sure that your web server's account has write permissions
      # in the current directory, for logging to work properly
      con = sqlite3.connect(create_log_db.DB_FILE)
      cur = con.cursor()

      cur.execute("INSERT INTO query_log VALUES (NULL, ?, ?, ?, ?, ?, ?)",
                  datetime.datetime.now(),
                  os.environ.get("REMOTE_ADDR", "N/A"),
                  os.environ.get("HTTP_USER_AGENT", "N/A"),
                  os.environ.get("HTTP_REFERER", "N/A"),
                  user_script,
                  int(cumulative_mode))
      con.commit()
      cur.close()
    except:
      # this is bad form, but silently fail on error ...
      pass

  print("Content-type: text/plain; charset=iso-8859-1\n")
  print(json_output)


cumulative_mode = False

# If you pass in a filename as an argument, then process script from that file ...
if len(sys.argv) > 1:
  user_script = open(sys.argv[1]).read()

# Otherwise act like a CGI script with parameters:
#   user_script
#   cumulative_mode
else:
  form = cgi.FieldStorage()
  user_script = form['user_script'].value
  if 'cumulative_mode' in form:
    # convert from string to a Python boolean ...
    cumulative_mode = (form['cumulative_mode'].value == 'true')

pg_logger.exec_script_str(user_script, cumulative_mode, cgi_finalizer)
