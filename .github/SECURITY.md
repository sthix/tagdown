# Security Policy

## Supported Versions

Tagdown Editor is pre-1.0. Security fixes are made on `main` and shipped in the
next release; older releases are not patched.

| Version         | Supported          |
| --------------- | ------------------ |
| Latest release  | :white_check_mark: |
| Older releases  | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Report them privately through GitHub's
[private vulnerability reporting](https://github.com/sthix/tagdown/security/advisories/new)
(the **Security → Report a vulnerability** button on this repository).

Please include as much of the following as you can:

- the type of issue (e.g. script injection in the preview, path traversal
  outside the vault, unsafe MCP tool behaviour, arbitrary file read/write)
- the affected version and macOS version
- steps to reproduce, ideally with a minimal note or vault that triggers it
- the impact you think it has and how an attacker could exploit it

### What to expect

- An acknowledgement within **7 days**.
- An initial assessment, and a fix timeline if the report is confirmed, within
  **30 days**.
- Credit in the release notes and the published advisory, unless you prefer to
  stay anonymous.

Please give us a reasonable chance to release a fix before disclosing the issue
publicly.

## Scope

In scope:

- the Tagdown Editor desktop app and its Tauri backend
- rendering of untrusted notes (Markdown, HTML, math, Mermaid, components)
- the bundled MCP server and the files it can read or write
- website publishing and export output
- the release build and signing pipeline in `.github/workflows`

Out of scope:

- vulnerabilities in third-party dependencies that are already publicly
  known — please report those upstream (a heads-up is still welcome)
- issues that require an already compromised machine or physical access
- social engineering or denial of service against the maintainer
