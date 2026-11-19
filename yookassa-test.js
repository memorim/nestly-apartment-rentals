export const testPaymentStatus = Object.freeze({
  pending: 'pending', authorized: 'waiting_for_capture', paid: 'succeeded', canceled: 'canceled',
});

export function testPayments({ shopId, testKey, origin } = {}) {
  if (!shopId && !testKey) return undefined;
  if (!/^\d+$/.test(shopId || '') || !/^test_[A-Za-z0-9_-]+$/.test(testKey || '') || !origin)
    throw new Error('Set a YooKassa test shop, test key and HTTPS APP_PUBLIC_ORIGIN');
  const authorization = 'Basic ' + Buffer.from(shopId + ':' + testKey).toString('base64');

  async function paymentRequest(path, payload, key) {
    const response = await fetch('https://api.yookassa.ru/v3/payments' + path, {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: authorization,
        ...(payload ? { 'Content-Type': 'application/json', 'Idempotence-Key': key } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('YooKassa test payment request failed');
    const payment = await response.json();
    if (payment.test !== true) throw new Error('A non-test payment was rejected');
    return payment;
  }

  return {
    create(booking) {
      return paymentRequest('', {
        amount: { value: booking.amount_rub.toFixed(2), currency: 'RUB' },
        capture: false,
        confirmation: { type: 'redirect', return_url: origin + '/account.html?booking=' + booking.id },
        description: 'Тестовое бронирование Nestly',
        metadata: { booking_id: booking.id },
      }, booking.id);
    },
    get: id => paymentRequest('/' + encodeURIComponent(id)),
    capture: (id, key) => paymentRequest('/' + encodeURIComponent(id) + '/capture', {}, key + '-capture'),
    cancel: (id, key) => paymentRequest('/' + encodeURIComponent(id) + '/cancel', {}, key + '-cancel'),
  };
}
