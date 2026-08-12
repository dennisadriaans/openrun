# Commercial licensing

Open Run is licensed under the [GNU Affero General Public License v3.0](./LICENSE).
For the overwhelming majority of users — anyone running it on their own machine,
for their own work, inside their own company — **AGPLv3 is free and imposes no
obligation on you**. You do not owe anyone source code for using this program.

This page is for the small number of cases where AGPLv3 genuinely does not fit.

---

## You do NOT need a commercial license to

- Run Open Run on your laptop, your workstation, or your build server.
- Run it inside a company, for internal work, on private repositories.
- Modify it for your own internal use and never publish those changes.
- Let your whole team run their own copies.
- Write automations, prompts, runtime presets, or scripts that drive it.

AGPLv3's obligations attach when you **distribute** the program or **make a
modified version available to others over a network**. Internal use is neither.

---

## You DO need a commercial license to

| Situation | Why AGPLv3 blocks it |
| --- | --- |
| Offer Open Run (modified or not) to third parties as a hosted or managed service | §13 requires you to offer *all* your modified source, including your control plane, under AGPLv3 |
| Embed Open Run in a proprietary product you distribute | §5 requires the combined work to be AGPLv3 |
| Ship it inside a closed-source appliance, IDE plugin, or desktop application | Same as above |
| Your organisation's policy forbids AGPL code in its estate entirely | Common at large enterprises; a commercial license removes the copyleft obligation |

A commercial license grants the same code under proprietary terms: no copyleft,
no source-disclosure obligation, and no AGPL conflict for your legal team.

---

## What a commercial license includes

- A perpetual, non-exclusive license to the Open Run core under proprietary terms.
- Freedom to embed, modify and distribute without AGPLv3 obligations.
- Written warranty and indemnity terms (AGPLv3 provides neither).
- Optional: access to the commercial planes — managed Slack app, fleet control
  plane, remote runners, SSO, audit log, policy engine. These are **separate
  proprietary products** and are not part of this repository.

---

## What is open source and what is not

Everything in this repository is AGPLv3 and stays that way.

**In this repository, free forever:** the scheduler, every runtime adapter
(Claude Code, Codex, Grok, Gemini, ACP), the executor, git actions and PR
creation, verification checks and verdicts, racing attempts, supervised
approvals, webhook integrations, the Slack control surface (using your own Slack
app), the planner, and the entire UI.

**Not in this repository, sold separately:** things that require *our* servers or
*our* compliance work — a managed Slack app, a fleet dashboard across machines,
hosted run history, remote runners, team seats and RBAC, SSO/SAML/SCIM, audit
export and the org policy engine.

No feature that runs on your machine will ever move behind that line. See the
[README](./README.md#open-source) for the standing commitment.

---

## Contact

Open a [GitHub Discussion](https://github.com/dennisadriaans/openrun/discussions)
or email the maintainer listed in [SECURITY.md](./SECURITY.md). Include:

1. What you want to build and how Open Run fits into it.
2. Whether you need distribution rights, hosting rights, or only a policy waiver.
3. Rough scale (seats, machines, or end customers).

Pricing is negotiated per deal; there is no public price list for the commercial
license.

---

*This page is a summary written for engineers, not a contract. The binding terms
are whatever appears in a signed commercial agreement, and where this summary and
that agreement disagree, the agreement wins.*
