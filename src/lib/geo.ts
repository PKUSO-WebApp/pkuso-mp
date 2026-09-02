/** 地理签到工具：GCJ-02 坐标系下的球面距离与围栏判定 */

const EARTH_RADIUS_M = 6371000
const RAD = Math.PI / 180

/** Haversine 球面距离（米）。两端坐标均为 GCJ-02 时无需坐标系转换 */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLng = (lng2 - lng1) * RAD
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * 围栏判定：定位点是否在「签到点 + 允许半径」内。
 * accuracy 为设备上报的定位误差（米），计入容差避免 GPS 抖动造成误拒。
 * 任一配置缺失（null/undefined）视为不限位置，直接通过。
 */
export function withinCheckinGeofence(
  point: { latitude: number; longitude: number; accuracy?: number | null },
  center: { lat: number | null; lng: number | null; radiusM: number | null }
): { ok: boolean; distanceM: number } {
  if (center.lat == null || center.lng == null || center.radiusM == null) {
    return { ok: true, distanceM: 0 }
  }
  const distanceM = distanceMeters(point.latitude, point.longitude, center.lat, center.lng)
  const effective = distanceM - (point.accuracy ?? 0)
  return { ok: effective <= center.radiusM, distanceM }
}
