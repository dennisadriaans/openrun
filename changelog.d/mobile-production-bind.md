- The mobile companion no longer works only against a development server.
  `pnpm start` now binds so a paired phone can reach `/api/mobile/**`, and an
  access token no longer locks the phone out of the app it was paired with —
  the device's own scoped token is what answers there. Everything else still
  refuses callers from other machines outright.
