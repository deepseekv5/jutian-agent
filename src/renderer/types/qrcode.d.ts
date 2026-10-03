declare module 'qrcode' {
  export function toDataURL(text: string, opts?: { width?: number; margin?: number; color?: { dark?: string; light?: string } }): Promise<string>
}
