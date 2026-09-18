import Image from "next/image";

import { activeClient } from "@config/index";

import styles from "./AppFooter.module.css";

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <Image
          src="/branding/nuaig-logo-white.svg"
          alt="Nuaig"
          width={110}
          height={45}
          className={styles.logo}
        />
        <p className={styles.attribution}>
          Built and managed by Nuaig for {activeClient.displayName}
        </p>
        <p className={styles.copyright}>
          &copy; {new Date().getFullYear()} Nuaig. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
