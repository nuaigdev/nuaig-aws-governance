import Image from "next/image";

import { activeClient } from "@config/index";
import { FOOTER_NOTICE } from "@/lib/notices";

import styles from "./AppFooter.module.css";

/**
 * Dark anchor band, shared by the signed-in shell and the sign-in page.
 *
 * This is the only place Nuaig's logo appears: the header and sign-in card
 * belong to the client. The logo links out to nuaig.ai in a new tab.
 */
export function AppFooter() {
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
