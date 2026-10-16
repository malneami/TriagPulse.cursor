import { setActiveRoutingConfig, resetRoutingConfigToBuiltin, setZoneStatus } from '@triagepulse/clinical';
import { api } from '@/api/client';

/**
 * Load the active patient-direction configuration (zones + rules) and the live
 * busy switches into the browser's routing engine. Offline / unauthorised → built-in.
 */
export async function syncRoutingConfigFromApi() {
  try {
    const current = await api.routingConfig.current();
    if (current?.config) setActiveRoutingConfig(current.config);
    else resetRoutingConfigToBuiltin();
    setZoneStatus(current?.zone_status || {});
    return current;
  } catch {
    return null;
  }
}
