import PDFDocument from 'pdfkit';
import Settings from '../models/Settings.js';

/**
 * Invoice Service
 *
 * Renders a GST-style tax invoice for an order as a PDF and pipes it straight
 * to the HTTP response — nothing is written to disk, so this scales across
 * multiple PM2 workers without a shared volume.
 */

const RUPEE = '₹';

const money = (n) => `${RUPEE}${Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
});

/** Draw a horizontal rule across the content area */
const rule = (doc, y) => {
  doc.save()
    .strokeColor('#E5E7EB')
    .lineWidth(1)
    .moveTo(40, y)
    .lineTo(555, y)
    .stroke()
    .restore();
};

/**
 * Stream a PDF invoice for `order` into `res`.
 * @param {import('mongoose').Document} order  Populated order document
 * @param {import('express').Response} res
 */
export const streamInvoice = async (order, res) => {
  const settings = await Settings.getSettings();

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  // ---------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------
  doc.fillColor('#F7931E').fontSize(22).font('Helvetica-Bold')
    .text(settings.siteName || 'AniLiving', 40, 45);
  doc.fillColor('#555555').fontSize(9).font('Helvetica')
    .text(settings.tagline || 'Everything Your Pet Deserves.', 40, 72);

  doc.fillColor('#222222').fontSize(18).font('Helvetica-Bold')
    .text('TAX INVOICE', 0, 45, { align: 'right' });
  doc.fillColor('#555555').fontSize(9).font('Helvetica')
    .text(`Invoice No: ${order.orderNumber}`, 0, 70, { align: 'right' })
    .text(`Date: ${formatDate(order.createdAt)}`, { align: 'right' });

  rule(doc, 100);

  // ---------------------------------------------------------------------
  // Seller / buyer blocks
  // ---------------------------------------------------------------------
  let y = 115;
  doc.fillColor('#999999').fontSize(8).font('Helvetica-Bold').text('SOLD BY', 40, y);
  doc.fillColor('#222222').fontSize(10).font('Helvetica-Bold')
    .text(settings.siteName || 'AniLiving', 40, y + 13);
  doc.fillColor('#555555').fontSize(9).font('Helvetica')
    .text(settings.address || '—', 40, y + 27, { width: 230 });
  if (settings.contactEmail) doc.text(settings.contactEmail, 40, doc.y + 2);
  if (settings.contactPhone) doc.text(settings.contactPhone, 40, doc.y + 2);

  const addr = order.shippingAddress || {};
  doc.fillColor('#999999').fontSize(8).font('Helvetica-Bold').text('SHIP TO', 320, y);
  doc.fillColor('#222222').fontSize(10).font('Helvetica-Bold')
    .text(addr.fullName || '—', 320, y + 13);
  doc.fillColor('#555555').fontSize(9).font('Helvetica')
    .text([
      addr.addressLine1,
      addr.addressLine2,
      [addr.city, addr.state].filter(Boolean).join(', '),
      addr.pincode,
      addr.country,
    ].filter(Boolean).join('\n'), 320, y + 27, { width: 235 })
    .text(`Phone: ${addr.phone || '—'}`, 320, doc.y + 2);

  y = Math.max(doc.y, y + 110) + 10;
  rule(doc, y);
  y += 12;

  // ---------------------------------------------------------------------
  // Line items table
  // ---------------------------------------------------------------------
  const cols = { item: 40, qty: 355, price: 405, total: 480 };

  doc.fillColor('#999999').fontSize(8).font('Helvetica-Bold')
    .text('ITEM', cols.item, y)
    .text('QTY', cols.qty, y, { width: 40, align: 'right' })
    .text('PRICE', cols.price, y, { width: 60, align: 'right' })
    .text('AMOUNT', cols.total, y, { width: 75, align: 'right' });
  y += 14;
  rule(doc, y);
  y += 8;

  doc.font('Helvetica').fontSize(9);
  for (const item of order.items) {
    // Page break if we're running out of room
    if (y > 690) {
      doc.addPage();
      y = 50;
    }

    const variantText = item.variant && item.variant.size
      ? [...item.variant.entries()].map(([k, v]) => `${k}: ${v}`).join(' | ')
      : '';

    doc.fillColor('#222222').text(item.name, cols.item, y, { width: 300 });
    const nameBottom = doc.y;
    if (variantText) {
      doc.fillColor('#888888').fontSize(8).text(variantText, cols.item, nameBottom, { width: 300 });
      doc.fontSize(9);
    }

    doc.fillColor('#222222')
      .text(String(item.quantity), cols.qty, y, { width: 40, align: 'right' })
      .text(money(item.price), cols.price, y, { width: 60, align: 'right' })
      .text(money(item.price * item.quantity), cols.total, y, { width: 75, align: 'right' });

    y = Math.max(doc.y, nameBottom) + 10;
  }

  rule(doc, y);
  y += 10;

  // ---------------------------------------------------------------------
  // Totals
  // ---------------------------------------------------------------------
  const totalsRow = (label, value, opts = {}) => {
    doc.fillColor(opts.strong ? '#222222' : '#555555')
      .font(opts.strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.strong ? 11 : 9)
      .text(label, 340, y, { width: 120, align: 'right' })
      .text(value, cols.total, y, { width: 75, align: 'right' });
    y += opts.strong ? 18 : 14;
  };

  totalsRow('Subtotal', money(order.itemsPrice));
  if (order.taxPrice) totalsRow('Tax (GST)', money(order.taxPrice));
  totalsRow('Shipping', order.shippingPrice ? money(order.shippingPrice) : 'FREE');
  if (order.discountAmount) {
    totalsRow(`Discount${order.coupon?.code ? ` (${order.coupon.code})` : ''}`, `- ${money(order.discountAmount)}`);
  }
  y += 4;
  rule(doc, y);
  y += 8;
  totalsRow('Total', money(order.totalPrice), { strong: true });

  // ---------------------------------------------------------------------
  // Payment + footer
  // ---------------------------------------------------------------------
  y += 12;
  doc.fillColor('#555555').fontSize(9).font('Helvetica')
    .text(
      `Payment: ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Razorpay'} — ${order.isPaid ? 'PAID' : 'PENDING'}`,
      40, y,
    );
  if (order.paymentResult?.razorpayPaymentId) {
    doc.text(`Transaction ID: ${order.paymentResult.razorpayPaymentId}`, 40, doc.y + 2);
  }
  doc.text(`Order status: ${String(order.status).replace(/_/g, ' ')}`, 40, doc.y + 2);

  doc.fillColor('#999999').fontSize(8)
    .text(
      'This is a computer-generated invoice and does not require a signature.',
      40, 780, { align: 'center', width: 515 },
    );

  doc.end();
};

export default { streamInvoice };
