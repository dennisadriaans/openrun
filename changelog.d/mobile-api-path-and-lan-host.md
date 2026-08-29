- The LAN mobile API no longer treats any URL that merely *starts with*
  `/api/mobile/` as in-bounds, so `../` and `%2e%2e` cannot walk onto desktop
  routes. When mobile is on, this machine's LAN addresses are allowed Host
  names, so pairing no longer needs `OPENRUN_ALLOWED_HOSTS` set to the phone's
  view of your Mac.
