export function locationErrorMessage(code: number) {
  if (code === 1) return 'Location permission denied. Enable it in browser settings to retry.';
  if (code === 2) return 'Device position unavailable. Waiting for another update.';
  return 'Location request timed out. Waiting for another update.';
}
export function watchEarthLocation(geolocation: Geolocation, success: PositionCallback, failure: PositionErrorCallback) {
  let active = true;
  const id = geolocation.watchPosition(position => { if (active) success(position); }, error => { if (active) failure(error); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  return () => { active = false; geolocation.clearWatch(id); };
}
