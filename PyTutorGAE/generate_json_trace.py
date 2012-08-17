# Generates a JSON trace that is compatible with the js/pytutor.js frontend

import sys, pg_logger, json, os
from optparse import OptionParser


def json_finalizer(input_code, output_trace):
  ret = dict(code=input_code, trace=output_trace)
  json_output = json.dumps(ret, indent=None) # use indent=None for most compact repr
  print(json_output)


parser = OptionParser(usage="Generate JSON trace for pytutor")
parser.add_option('-c', '--cumulative', default=False, action='store_true',
        help='output cumulative trace.')
options, args = parser.parse_args()

for f in args:
  fin = sys.stdin if f == "-" else open(f)
  pg_logger.exec_script_str(fin.read(), options.cumulative, json_finalizer)
