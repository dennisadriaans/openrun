You no longer risk a mobile API URL that merely *starts with* `/api/mobile/` walking onto desktop routes — `../` and `%2e%2e` are now resolved and refused.

When mobile is on, Open Run accepts this machine’s LAN IPs as Host names, so pairing no longer needs `OPENRUN_ALLOWED_HOSTS` set to your phone’s view of your Mac.
