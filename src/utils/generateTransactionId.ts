export async function generateFallbackTransactionId(
  date: string,
  amount: string,
  description: string,
  bankName: string
): Promise<string> {
  const canonical = JSON.stringify({
    date,
    amount,
    description: description.toLowerCase().trim(),
    bank: bankName.toLowerCase().trim(),
  })
  const data = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
