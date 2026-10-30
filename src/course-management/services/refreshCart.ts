/** Ask the page hook to refresh MyPack's cart table and calendar together. */
export function refreshCart(): void {
  const message = { type: "MYPACK_REFRESH_CART", source: "content-script" };
  const origin = window.location.origin;
  window.postMessage(message, origin);
  for (const frame of document.querySelectorAll("iframe")) {
    frame.contentWindow?.postMessage(message, origin);
  }
}
