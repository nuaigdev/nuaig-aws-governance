import Image from "next/image";

import { activeClient } from "@config/index";
import { FOOTER_NOTICE } from "@/lib/notices";

import styles from "./AppFooter.module.css";

/**
 * Dark anchor band, shared by the signed-in shell and the sign-in page.
 *
 * ## Nuaig's branding is opt-in, and clients do not opt in
 *
 * A client portal carries the client's identity and nothing else — no logo of
 * ours, no "built and managed by", no copyright line naming us. The header and
 * sign-in card were already the client's; this makes the footer match, so there
 * is no surface in the product that names us to their staff.
 *
 * The flag lives in the client config and defaults to false, so a new client
 * added later is unbranded without anyone having to remember. Only our own
 * showcase tenant turns it on.
 *
 * What remains for a client is the confidentiality line, which is about their
 * data rather than about us, and is the reason this band still exists at all.
 */
export function AppFooter() {
  if (!activeClient.showNuaigBranding) {
    return (
      <footer className={styles.footer}>
        <div className={styles.inner}>
          <p className={styles.notice}>{FOOTER_NOTICE}</p>
        </div>
      </footer>
    );
  }

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <a
          href="https://nuaig.ai"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.logoLink}
          aria-label="Nuaig (opens nuaig.ai in a new tab)"
        >
          <Image
            src="/branding/nuaig-logo-white.svg"
            alt="Nuaig"
            width={110}
            height={45}
            className={styles.logo}
          />
        </a>
        <div className={styles.text}>
          <p className={styles.attribution}>
            Built and managed by Nuaig for {activeClient.displayName}
          </p>
          <p className={styles.notice}>{FOOTER_NOTICE}</p>
        </div>
        <p className={styles.copyright}>
          &copy; {new Date().getFullYear()} Nuaig. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
