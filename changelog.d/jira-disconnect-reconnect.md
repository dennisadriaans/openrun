You no longer have to get Disconnect exactly right before connecting Jira
again. Reconnect retires the old site-wide hook (including connections made
before the project picker existed), and Disconnect still drops the local row
even when Atlassian refuses to delete the leftover webhook — it tells you so
you can tidy that by hand.
