- Weekly releases no longer stall: the release commit is now signed and
  attributed, so branch protection stops holding the release pull request for an
  approval that the automation could never give.
- A release pull request that has not merged yet no longer fails the scheduled
  job — it stays queued and the next run publishes it once it lands.
