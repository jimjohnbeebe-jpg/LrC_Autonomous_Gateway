local LrDialogs = import 'LrDialogs'
local S2Server = require 'S2Server'

LrDialogs.message("AVG S2 status", S2Server.statusText(), "info")
