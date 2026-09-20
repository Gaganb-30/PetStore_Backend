import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import mongoose from 'mongoose';
import Settings from '../models/Settings.js';
import config from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Convert number to words in Indian numbering system */
export const numberToWords = (num) => {
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convert = (n) => {
    if (n === 0) return '';
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ` ${a[n % 10]}` : '');
    if (n < 1000) return `${a[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${convert(n % 100)}` : ''}`;
    if (n < 100000) return `${convert(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${convert(n % 1000)}` : ''}`;
    if (n < 10000000) return `${convert(Math.floor(n / 100000))} Lakh${n % 100000 ? ` ${convert(n % 100000)}` : ''}`;
    return `${convert(Math.floor(n / 10000000))} Crore${n % 10000000 ? ` ${convert(n % 10000000)}` : ''}`;
  };

  const parts = Number(num || 0).toFixed(2).split('.').map(Number);
  const rupees = parts[0];
  const paise = parts[1];
  let words = rupees === 0 ? 'Zero Rupees' : `${convert(rupees)} Rupees`;
  if (paise > 0) words += ` and ${convert(paise)} Paise`;
  return `${words} only`;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const formatDate = (date) => {
  const d = new Date(date || Date.now());
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
};

const formatDateTime = (date) => {
  const d = new Date(date || Date.now());
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hours}:${mins}:${secs} hrs`;
};

const findLogoPath = () => {
  const candidates = [
    path.resolve(__dirname, '../assets/logo.png'),
    path.resolve(__dirname, '../../client/public/logo.png'),
    path.resolve(process.cwd(), 'assets/logo.png'),
    path.resolve(process.cwd(), 'server/assets/logo.png'),
    path.resolve(process.cwd(), '../client/public/logo.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
};

/**
 * Stream a compliant GST Tax Invoice for `order` into `res`.
 * @param {import('mongoose').Document} order  Populated order document
 * @param {import('express').Response} res
 */
export const streamInvoice = async (order, res) => {
  let settings = {};
  try {
    if (mongoose.connection?.readyState === 1) {
      settings = (await Settings.getSettings()) || {};
    }
  } catch {
    // fallback to empty settings object
  }

  const seller = {
    name: config.seller?.name || settings.siteName || 'AniLiving',
    addressLine1: config.seller?.addressLine1 || settings.address || 'C-279, Karawal Nagar, Gali Number 7',
    addressLine2: config.seller?.addressLine2 || 'Mukund Vihar',
    city: config.seller?.city || 'North East Delhi',
    state: config.seller?.state || 'Delhi',
    pincode: config.seller?.pincode || '110094',
    country: config.seller?.country || 'IN',
    pan: config.seller?.pan || '',
    gstin: config.seller?.gstin || '',
  };

  const doc = new PDFDocument({ size: 'A4', margin: 35 });
  doc.pipe(res);

  // ---------------------------------------------------------------------
  // 1. Header (Logo + Brand Name on left, Tax Invoice Header on right)
  // ---------------------------------------------------------------------
  const logoPath = findLogoPath();
  if (logoPath) {
    try {
      doc.image(logoPath, 35, 30, { fit: [140, 45] });
    } catch {
      doc.font('Helvetica-Bold').fontSize(22).fillColor('#F7931E').text(seller.name, 35, 30);
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#F7931E').text(seller.name, 35, 30);
  }

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000')
    .text('Tax Invoice/Bill of Supply/Cash Memo', 250, 30, { align: 'right', width: 310 });
  doc.font('Helvetica').fontSize(9).fillColor('#333333')
    .text('(Original for Recipient)', 250, 45, { align: 'right', width: 310 });

  let y = 90;

  // ---------------------------------------------------------------------
  // 2. Sold By (left) vs Billing & Shipping (right)
  // ---------------------------------------------------------------------
  const leftX = 35;
  const rightX = 300;
  const colW = 260;

  // Left column: Sold By
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text('Sold By :', leftX, y);
  doc.font('Helvetica-Bold').fontSize(9).text(seller.name, leftX, y + 12);
  doc.font('Helvetica').fontSize(8.5).fillColor('#222222');
  let soldY = y + 24;
  doc.text('*', leftX, soldY);
  soldY += 10;
  if (seller.addressLine1) { doc.text(seller.addressLine1, leftX, soldY, { width: 240 }); soldY = doc.y; }
  if (seller.addressLine2) { doc.text(seller.addressLine2, leftX, soldY, { width: 240 }); soldY = doc.y; }
  doc.text(`${seller.city}, ${seller.state}, ${seller.pincode}`, leftX, soldY, { width: 240 });
  soldY = doc.y;
  doc.text(seller.country || 'IN', leftX, soldY);
  soldY = doc.y + 8;

  doc.font('Helvetica-Bold').fontSize(8.5).text(`PAN No: ${seller.pan || '—'}`, leftX, soldY);
  soldY += 12;
  doc.font('Helvetica-Bold').fontSize(8.5).text(`GST Registration No: ${seller.gstin || '—'}`, leftX, soldY);

  // Right column: Billing & Shipping Addresses
  const addr = order.shippingAddress || {};
  let rightY = y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000')
    .text('Billing Address :', rightX, rightY, { align: 'right', width: colW });
  rightY += 12;
  doc.font('Helvetica').fontSize(8.5).fillColor('#222222')
    .text(addr.fullName || '—', rightX, rightY, { align: 'right', width: colW });
  rightY = doc.y;
  if (addr.addressLine1) { doc.text(addr.addressLine1, rightX, rightY, { align: 'right', width: colW }); rightY = doc.y; }
  if (addr.addressLine2) { doc.text(addr.addressLine2, rightX, rightY, { align: 'right', width: colW }); rightY = doc.y; }
  doc.text(`${addr.city}, ${addr.state}, ${addr.pincode}`, rightX, rightY, { align: 'right', width: colW });
  rightY = doc.y;
  doc.text(addr.country || 'IN', rightX, rightY, { align: 'right', width: colW });
  rightY = doc.y + 8;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000')
    .text('Shipping Address :', rightX, rightY, { align: 'right', width: colW });
  rightY += 12;
  doc.font('Helvetica').fontSize(8.5).fillColor('#222222')
    .text(addr.fullName || '—', rightX, rightY, { align: 'right', width: colW });
  rightY = doc.y;
  if (addr.addressLine1) { doc.text(addr.addressLine1, rightX, rightY, { align: 'right', width: colW }); rightY = doc.y; }
  if (addr.addressLine2) { doc.text(addr.addressLine2, rightX, rightY, { align: 'right', width: colW }); rightY = doc.y; }
  doc.text(`${addr.city}, ${addr.state}, ${addr.pincode}`, rightX, rightY, { align: 'right', width: colW });
  rightY = doc.y;
  doc.text(addr.country || 'IN', rightX, rightY, { align: 'right', width: colW });
  rightY = doc.y + 4;

  const place = (addr.state || seller.state || 'Delhi').toUpperCase();
  doc.font('Helvetica-Bold').fontSize(8.5)
    .text(`Place of supply: ${place}`, rightX, rightY, { align: 'right', width: colW });
  rightY += 11;
  doc.font('Helvetica-Bold').fontSize(8.5)
    .text(`Place of delivery: ${place}`, rightX, rightY, { align: 'right', width: colW });
  rightY += 14;

  y = Math.max(soldY + 20, rightY + 10);

  // ---------------------------------------------------------------------
  // 3. Order & Invoice Identifiers
  // ---------------------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
  doc.text(`Order Number: ${order.orderNumber}`, leftX, y);
  doc.text(`Order Date: ${formatDate(order.createdAt)}`, leftX, y + 13);

  const invNum = `IN-${order.orderNumber.replace(/[^0-9]/g, '').slice(-4) || '32'}`;
  const invDetails = `DL-${order._id.toString().slice(-10).toUpperCase()}`;
  doc.text(`Invoice Number : ${invNum}`, rightX, y, { align: 'right', width: colW });
  doc.font('Helvetica-Bold').fontSize(8.5)
    .text(`Invoice Details : ${invDetails}`, rightX, y + 13, { align: 'right', width: colW });
  doc.font('Helvetica-Bold').fontSize(9)
    .text(`Invoice Date : ${formatDate(order.createdAt)}`, rightX, y + 26, { align: 'right', width: colW });

  y += 45;

  // ---------------------------------------------------------------------
  // 4. Line items table
  // ---------------------------------------------------------------------
  const tableX = 35;
  const tableW = 525;
  const cols = [
    { id: 'sl', label: 'Sl.\nNo', x: 35, w: 22, align: 'center' },
    { id: 'desc', label: 'Description', x: 57, w: 178, align: 'left' },
    { id: 'unitPrice', label: 'Unit\nPrice', x: 235, w: 45, align: 'right' },
    { id: 'qty', label: 'Qty', x: 280, w: 20, align: 'center' },
    { id: 'netAmount', label: 'Net\nAmount', x: 300, w: 50, align: 'right' },
    { id: 'taxRate', label: 'Tax\nRate', x: 350, w: 32, align: 'right' },
    { id: 'taxType', label: 'Tax\nType', x: 382, w: 38, align: 'center' },
    { id: 'taxAmount', label: 'Tax\nAmount', x: 420, w: 45, align: 'right' },
    { id: 'totalAmount', label: 'Total\nAmount', x: 465, w: 95, align: 'right' },
  ];

  const headerH = 22;

  const renderTableHeader = (currentY) => {
    doc.save();
    doc.fillColor('#E5E5E5').rect(tableX, currentY, tableW, headerH).fill();
    doc.strokeColor('#000000').lineWidth(0.75).rect(tableX, currentY, tableW, headerH).stroke();

    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(7.5);
    for (const c of cols) {
      doc.text(c.label, c.x + 2, currentY + 3, { width: c.w - 4, align: c.align });
    }
    for (let i = 1; i < cols.length; i++) {
      doc.moveTo(cols[i].x, currentY).lineTo(cols[i].x, currentY + headerH).stroke();
    }
    doc.restore();
    return currentY + headerH;
  };

  y = renderTableHeader(y);

  const isIntraState = (addr.state || '').trim().toLowerCase() === (seller.state || '').trim().toLowerCase();
  const taxRate = Number(settings.taxRate) || 18;

  let totalTaxSum = 0;
  let totalAmountSum = 0;

  let slNo = 1;
  for (const item of order.items) {
    const itemTotal = round2(item.price * item.quantity);
    const netAmount = round2(itemTotal / (1 + taxRate / 100));
    const unitPrice = round2(netAmount / item.quantity);
    const taxAmount = round2(itemTotal - netAmount);

    totalTaxSum += taxAmount;
    totalAmountSum += itemTotal;

    const cgstRate = taxRate / 2;
    const sgstRate = taxRate / 2;
    const cgstAmount = round2(taxAmount / 2);
    const sgstAmount = round2(taxAmount - cgstAmount);

    const variantText = item.variant
      ? (item.variant instanceof Map
        ? [...item.variant.entries()].map(([k, v]) => `${k}: ${v}`).join(', ')
        : typeof item.variant === 'object'
          ? Object.entries(item.variant).map(([k, v]) => `${k}: ${v}`).join(', ')
          : String(item.variant))
      : '';

    const descLines = [
      item.name,
      variantText ? `Variant: ${variantText}` : '',
      item.sku ? `SKU: ${item.sku}` : '',
      'HSN:4201',
    ].filter(Boolean).join('\n');

    const measuredDescH = doc.heightOfString(descLines, { width: cols[1].w - 8, font: 'Helvetica', size: 7.5 });
    const rowH = Math.max(measuredDescH + 12, 34);

    // Page break if running out of room
    if (y + rowH > 700) {
      doc.addPage();
      y = renderTableHeader(35);
    }

    doc.save();
    doc.strokeColor('#000000').lineWidth(0.75).rect(tableX, y, tableW, rowH).stroke();
    for (let i = 1; i < cols.length; i++) {
      doc.moveTo(cols[i].x, y).lineTo(cols[i].x, y + rowH).stroke();
    }
    doc.restore();

    doc.fillColor('#000000').font('Helvetica').fontSize(7.5);
    doc.text(String(slNo++), cols[0].x + 2, y + 5, { width: cols[0].w - 4, align: 'center' });
    doc.text(descLines, cols[1].x + 4, y + 5, { width: cols[1].w - 8, align: 'left', lineGap: 1 });
    doc.text(unitPrice.toFixed(2), cols[2].x + 2, y + 5, { width: cols[2].w - 4, align: 'right' });
    doc.text(String(item.quantity), cols[3].x + 2, y + 5, { width: cols[3].w - 4, align: 'center' });
    doc.text(netAmount.toFixed(2), cols[4].x + 2, y + 5, { width: cols[4].w - 4, align: 'right' });

    if (isIntraState) {
      doc.text(`${cgstRate}%\n\n${sgstRate}%`, cols[5].x + 2, y + 5, { width: cols[5].w - 4, align: 'right' });
      doc.text('CGST\n\nSGST', cols[6].x + 2, y + 5, { width: cols[6].w - 4, align: 'center' });
      doc.text(`${cgstAmount.toFixed(2)}\n\n${sgstAmount.toFixed(2)}`, cols[7].x + 2, y + 5, { width: cols[7].w - 4, align: 'right' });
    } else {
      doc.text(`${taxRate}%`, cols[5].x + 2, y + 5, { width: cols[5].w - 4, align: 'right' });
      doc.text('IGST', cols[6].x + 2, y + 5, { width: cols[6].w - 4, align: 'center' });
      doc.text(taxAmount.toFixed(2), cols[7].x + 2, y + 5, { width: cols[7].w - 4, align: 'right' });
    }

    doc.text(itemTotal.toFixed(2), cols[8].x + 2, y + 5, { width: cols[8].w - 4, align: 'right' });

    y += rowH;
  }

  // Discount row if applied
  if (order.discountAmount > 0) {
    const discountTotal = round2(order.discountAmount);
    const discountNet = round2(discountTotal / (1 + taxRate / 100));
    const discountTax = round2(discountTotal - discountNet);

    totalTaxSum = Math.max(0, totalTaxSum - discountTax);
    totalAmountSum = Math.max(0, totalAmountSum - discountTotal);

    const discH = 18;
    doc.save();
    doc.strokeColor('#000000').lineWidth(0.75).rect(tableX, y, tableW, discH).stroke();
    for (let i = 1; i < cols.length; i++) {
      doc.moveTo(cols[i].x, y).lineTo(cols[i].x, y + discH).stroke();
    }
    doc.restore();

    doc.fillColor('#000000').font('Helvetica').fontSize(7.5);
    doc.text(String(slNo++), cols[0].x + 2, y + 4, { width: cols[0].w - 4, align: 'center' });
    doc.text(`Coupon Discount (${order.coupon?.code || 'COUPON'})`, cols[1].x + 4, y + 4, { width: cols[1].w - 8 });
    doc.text(`-${discountNet.toFixed(2)}`, cols[4].x + 2, y + 4, { width: cols[4].w - 4, align: 'right' });
    doc.text(`-${discountTax.toFixed(2)}`, cols[7].x + 2, y + 4, { width: cols[7].w - 4, align: 'right' });
    doc.text(`-${discountTotal.toFixed(2)}`, cols[8].x + 2, y + 4, { width: cols[8].w - 4, align: 'right' });
    y += discH;
  }

  // Shipping row
  if (order.shippingPrice > 0) {
    const shipTotal = round2(order.shippingPrice);
    totalAmountSum += shipTotal;

    const shipH = 18;
    doc.save();
    doc.strokeColor('#000000').lineWidth(0.75).rect(tableX, y, tableW, shipH).stroke();
    for (let i = 1; i < cols.length; i++) {
      doc.moveTo(cols[i].x, y).lineTo(cols[i].x, y + shipH).stroke();
    }
    doc.restore();

    doc.fillColor('#000000').font('Helvetica').fontSize(7.5);
    doc.text(String(slNo++), cols[0].x + 2, y + 4, { width: cols[0].w - 4, align: 'center' });
    doc.text('Shipping & Delivery Charges', cols[1].x + 4, y + 4, { width: cols[1].w - 8 });
    doc.text(shipTotal.toFixed(2), cols[8].x + 2, y + 4, { width: cols[8].w - 4, align: 'right' });
    y += shipH;
  }

  // ---------------------------------------------------------------------
  // 5. TOTAL row
  // ---------------------------------------------------------------------
  const finalTotal = round2(order.totalPrice || totalAmountSum);
  const totalH = 16;
  doc.save();
  doc.fillColor('#E5E5E5').rect(tableX, y, tableW, totalH).fill();
  doc.strokeColor('#000000').lineWidth(0.75).rect(tableX, y, tableW, totalH).stroke();
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
  doc.text('TOTAL:', tableX + 4, y + 4);
  doc.text(totalTaxSum.toFixed(2), cols[7].x + 2, y + 4, { width: cols[7].w - 4, align: 'right' });
  doc.text(finalTotal.toFixed(2), cols[8].x + 2, y + 4, { width: cols[8].w - 4, align: 'right' });
  doc.restore();

  y += totalH;

  // ---------------------------------------------------------------------
  // 6. Amount in Words box
  // ---------------------------------------------------------------------
  const wordsH = 26;
  doc.save();
  doc.strokeColor('#000000').lineWidth(0.75).rect(tableX, y, tableW, wordsH).stroke();
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8)
    .text('Amount in Words:', tableX + 6, y + 4);
  doc.font('Helvetica-Bold').fontSize(8.5)
    .text(numberToWords(finalTotal), tableX + 6, y + 14);
  doc.restore();

  y += wordsH + 12;

  // ---------------------------------------------------------------------
  // 7. Signatory block (right)
  // ---------------------------------------------------------------------
  const sigW = 220;
  const sigX = tableX + tableW - sigW;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000')
    .text(`For ${seller.name}:`, sigX, y, { align: 'right', width: sigW });

  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#555555')
    .text('(Computer generated invoice — No signature required)', sigX, y + 25, { align: 'right', width: sigW });

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000')
    .text('Authorized Signatory', sigX, y + 42, { align: 'right', width: sigW });

  y += 56;

  // ---------------------------------------------------------------------
  // 8. Reverse charge note
  // ---------------------------------------------------------------------
  doc.font('Helvetica').fontSize(8).fillColor('#000000')
    .text('Whether tax is payable under reverse charge - No', tableX, y);

  y += 18;

  // ---------------------------------------------------------------------
  // 9. Bottom Transaction Box (4 bordered columns)
  // ---------------------------------------------------------------------
  const txnBoxH = 26;
  const txnCols = [
    {
      label: 'Payment Transaction ID:',
      val: order.paymentResult?.razorpayPaymentId || (order.paymentMethod === 'cod' ? 'COD' : 'PENDING'),
      x: tableX,
      w: 165,
    },
    {
      label: 'Date & Time:',
      val: formatDateTime(order.createdAt),
      x: tableX + 165,
      w: 145,
    },
    {
      label: 'Invoice Value:',
      val: finalTotal.toFixed(2),
      x: tableX + 310,
      w: 85,
    },
    {
      label: 'Mode of Payment:',
      val: order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Online / UPI / Netbanking',
      x: tableX + 395,
      w: 130,
    },
  ];

  doc.save();
  doc.strokeColor('#000000').lineWidth(0.75).rect(tableX, y, tableW, txnBoxH).stroke();
  for (let i = 1; i < txnCols.length; i++) {
    doc.moveTo(txnCols[i].x, y).lineTo(txnCols[i].x, y + txnBoxH).stroke();
  }
  doc.fillColor('#000000');
  for (const c of txnCols) {
    doc.font('Helvetica-Bold').fontSize(6.5).text(c.label, c.x + 4, y + 3, { width: c.w - 8 });
    doc.font('Helvetica').fontSize(7.5).text(c.val, c.x + 4, y + 13, { width: c.w - 8 });
  }
  doc.restore();

  doc.end();
};

export default { streamInvoice, numberToWords };
