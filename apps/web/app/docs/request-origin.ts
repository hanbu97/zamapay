export function requestOrigin(request: Request): string {
  const host = request.headers.get("host") ?? request.headers.get("x-forwarded-host")
  if (!host) {
    return new URL(request.url).origin
  }

  const forwardedProto = request.headers.get("x-forwarded-proto")
  const protocol = forwardedProto ?? new URL(request.url).protocol.replace(/:$/, "")
  return `${protocol}://${host}`
}
