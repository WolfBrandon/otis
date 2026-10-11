# Security

## How OTIS is meant to run

OTIS has **no login**. Anyone who can reach its port can read, change and
delete your projects. That's why it only listens on your own computer
(`127.0.0.1`) by default, whether you install it natively, with Docker or as a
package.

If you open it up to your network (`OTIS_BIND=0.0.0.0` with Docker), keep it on
a network you trust. Don't expose it to the internet without a reverse proxy
that adds authentication.

The MCP server (`mcp.js`) can do whatever the OTIS web page can: read, create
and change projects. It can't delete whole projects. It only talks to the
OTIS server you point it at.

## Supported versions

Security fixes go into the newest release. Please update before reporting
(Help → About OTIS shows your version and whether a newer one is out).

## Reporting a problem

Please **don't** open a public issue for a security problem. Report it
privately on GitHub instead: go to the
[Security tab](https://github.com/WolfBrandon/otis/security) and choose
**Report a vulnerability**. Include what you found, how to reproduce it, and
the OTIS version.

You'll get a reply within a few days. OTIS is a one-person hobby project, so
please allow some time for a fix.
