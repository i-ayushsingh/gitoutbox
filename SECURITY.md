# Security Policy

## Supported Versions

Only the latest release receives security updates.

| Version | Supported |
| ------- | --------- |
| v0.1.x  | Yes       |
| < v0.1.0| No        |

---

## Scope

This security policy covers the GitOutbox desktop application, the `gitoutbox-core` crate, and the Tauri backend modules. 

Note that GitOutbox operates purely locally on your machine. It does not:
* Transmit repository contents or credentials over the network.
* Collect user logins, Git credentials, or OAuth tokens.
* Host web servers or expose network ports (Tauri communicates locally via secure IPC channels).

---

## How to Report a Vulnerability

If you discover a security vulnerability in GitOutbox, please **do not** open a public issue. Instead, report it privately to the maintainers:

* **Email**: We will update this in some time.
* **GPG Key**: We will update this in some time

We will acknowledge receipt of your report within **48 hours** and provide a follow-up detailing the expected resolution timeline.

---

## Disclosure Policy

GitOutbox follows a coordinated disclosure model:
1. **Reporting**: The reporter notifies maintainers of the vulnerability privately.
2. **Triaging**: Maintainers verify and patch the vulnerability.
3. **Disclosure**: A patched release is published alongside a security advisory within **90 days** of the initial report, or sooner once coordinate agreement is reached.
