/**
 * Guards for running on Android: Termux, with Debian under proot-distro.
 *
 * Android 11+ refuses the netlink call behind os.networkInterfaces(), so under
 * proot it throws "uv_interface_addresses returned Unknown system error 13"
 * instead of returning a list. Nothing in this bot needs the interface list,
 * but a dependency that asks for it (gcp-metadata's GCE check, via
 * google-auth-library) would take the whole process down. Returning an empty
 * list is what those callers already handle as "no interfaces found".
 *
 * The interface guard is a no-op everywhere the real call works, including
 * Render and Docker. The connect-timeout change below applies everywhere.
 */
import net from "net";
import os from "os";

/**
 * Node tries each address of a multi-address host for only 250 ms before
 * moving on ("happy eyeballs"). Neon's pooler has 3 addresses in us-east-1;
 * from India a TCP connect there takes ~270 ms, so on a phone link every
 * attempt timed out and pg failed with an empty AggregateError. 2 s per
 * attempt still fails over quickly when an address is really dead.
 */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 2000;

function relaxConnectAttemptTimeout(): void {
  const wanted = Number(process.env.NET_ATTEMPT_TIMEOUT_MS) || DEFAULT_ATTEMPT_TIMEOUT_MS;
  // Only ever raise it: an explicit --network-family-autoselection-attempt-timeout wins if larger.
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === "function" &&
      net.getDefaultAutoSelectFamilyAttemptTimeout() < wanted) {
    net.setDefaultAutoSelectFamilyAttemptTimeout(wanted);
  }
}

export function installPlatformShims(): void {
  relaxConnectAttemptTimeout();
  const original = os.networkInterfaces;
  try {
    original();
    return;
  } catch {
    /* fall through: this platform needs the guard */
  }
  (os as any).networkInterfaces = () => {
    try {
      return original();
    } catch {
      return {};
    }
  };
  console.log("[platform] os.networkInterfaces() unavailable (Android/proot); using an empty list.");
}
