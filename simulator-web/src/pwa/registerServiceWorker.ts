export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    if (import.meta.env.DEV) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister()
        })
      })
      return
    }
    void navigator.serviceWorker.register('/sw.js')
  })
}
