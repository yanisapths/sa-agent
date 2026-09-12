# Web browser security guideline

**Objective**

The objective of this guideline is to define the baseline security requirements, configuration standards, and data handling practices for browser-side mechanisms. This aims to minimize risks related to **Cross-Site Scripting (XSS)**, **Cross-Site Request Forgery (CSRF)**, **clickjacking**, and **unauthorized client-side data exposure**.

**Scope**

This guideline applies to all web applications, front-end platforms, customer-facing portals, and internal administrative consoles managed by the organization.

**Client-Side Data Storage & Cookie Rules**

Data storage within the browser must strictly align with your organization's Data Classification rules.

- `localStorage`** & **`sessionStorage`: Limited to non-sensitive cached data. These mechanisms have no security flags to block JavaScript access.
- **Cookies**: Recognized as a data storage mechanism that automatically transmits state over the network. **They are strongly recommended for storing authentication credentials** and are the only storage format allowed to hold active session identifiers when heavily locked down with specific attributes:
  - `HttpOnly`: **Required** to block JavaScript scraping and prevent token theft.
  - `Secure`: **Required** to force transmission exclusively over encrypted HTTPS.
  - `SameSite` (`Strict` or `Lax`): **Required** to control cross-site boundaries and mitigate CSRF.

| Storage Mechanism  | HTTPOnly Flag | Secure Flag | SameSite   |
| ------------------ | ------------- | ----------- | ---------- |
| **Cookie**         | Required      | Required    | Required   |
| **localStorage**   | Don’t have    | Don’t have  | Don’t have |
| **sessionStorage** | Don’t have    | Don’t have  | Don’t have |

**Mandatory HTTP Security Headers**

To enforce restrictive browser behavior and harden applications against infrastructure-level exploits, all production environments must deliver the following security headers:

|                                      |                                                                               |                                                                                                                                                                  |                                                                                                                      |                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Security Header**                  | **Mandatory Configuration Directive**                                         | **Operational Security Control**                                                                                                                                 | **Mitigation Objective**                                                                                             | **Deployment Scope**                                          |
| **HSTS** (Strict-Transport-Security) | `max-age=31536000; includeSubDomains`                                         | Forces all connections exclusively over HTTPS, overriding standard HTTP attempts.                                                                                | Prevents Man-in-the-Middle (MITM) and SSL-stripping attacks.                                                         | **Required:** Web Application**Optional:** Mobile Application |
| **CSP** (Content-Security-Policy)    | `default-src 'self';``frame-ancestors 'self';`(Or context-approved whitelist) | 1. Restricts resource loading exclusively to trusted domains. 2. Restricts which external sites are permitted to embed the application within an `<iframe>`**.** | 1. Mitigates Cross-Site Scripting (XSS). 2. Prevents Clickjacking attacks (replaces the deprecated X-Frame-Options). | **Required:** Web Application**N/A:** Mobile Application      |
| **X-Content-Type-Options**           | `nosniff`                                                                     | Forces the browser to strictly follow the MIME types declared by the server.                                                                                     | Prevents executable code from being masked as passive media (MIME-sniffing).                                         | **Required:** Web Application**Required:** Mobile Application |
