local LrDialogs = import 'LrDialogs'
local S2Server = require 'S2Server'

S2Server.start()
LrDialogs.showBezel("AVG S2 echo server starting (8765 receive / 8766 send)")
