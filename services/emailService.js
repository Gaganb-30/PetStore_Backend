import nodemailer from 'nodemailer';
import config from '../config/index.js';

/**
 * Email Service using Nodemailer
 * Handles all transactional emails: order confirmation, password reset, etc.
 */

// A single pooled transporter is reused for the life of the process. Creating
// one per email opens a fresh SMTP connection every time, which most providers
// rate-limit aggressively.
let transporter;
const getTransporter = () => {
  if (!config.email.user || !config.email.pass) return null; // SMTP not configured
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.user, pass: config.email.pass },
      pool: true,
      maxConnections: 3,
    });
  }
  return transporter;
};

/**
 * Send an email. Never throws: transactional mail is a side effect of checkout
 * and account flows, and an SMTP outage must not fail a customer's order.
 */
const sendEmail = async ({ to, subject, html, text }) => {
  const tx = getTransporter();
  if (!tx) {
    console.warn(`✉️  SMTP not configured — skipped "${subject}" to ${to}`);
    return null;
  }
  try {
    const info = await tx.sendMail({ from: config.email.from, to, subject, html, text });
    console.log(`📧 Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Shared layout so every email looks like the same brand
// ---------------------------------------------------------------------------
const layout = (title, body) => `
  <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#fff;">
    <div style="background:#F7931E;padding:28px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:26px;">AniLiving</h1>
      <p style="color:#fff;margin:4px 0 0;opacity:.9;font-size:13px;">Everything Your Pet Deserves.</p>
    </div>
    <div style="padding:28px;color:#222;">
      <h2 style="color:#1B2A4A;margin-top:0;">${title}</h2>
      ${body}
    </div>
    <div style="background:#1B2A4A;padding:18px;text-align:center;">
      <p style="color:#fff;margin:0;font-size:13px;">© ${new Date().getFullYear()} AniLiving. All rights reserved.</p>
    </div>
  </div>
`;

const STATUS_COPY = {
  pending: ['Awaiting payment', 'We are waiting for your payment to be confirmed.'],
  confirmed: ['Order confirmed', 'We have received your order and are getting it ready.'],
  processing: ['Order being packed', 'Our team is packing your order right now.'],
  shipped: ['Order shipped', 'Your order is on its way to you.'],
  out_for_delivery: ['Out for delivery', 'Your order will reach you today.'],
  delivered: ['Order delivered', 'Your order has been delivered. We hope your pet loves it!'],
  cancelled: ['Order cancelled', 'Your order has been cancelled.'],
  returned: ['Order returned', 'We have received your return.'],
  refunded: ['Refund processed', 'Your refund has been processed and will reflect shortly.'],
};

/**
 * Order status update email — sent whenever an admin (or the customer) moves an
 * order to a new state. Includes the tracking link when one has been set.
 */
export const sendOrderStatusUpdate = async (user, order) => {
  const [heading, message] = STATUS_COPY[order.status] || ['Order update', 'Your order status has been updated.'];

  const tracking = order.trackingNumber || order.trackingUrl ? `
    <div style="background:#FFF5E9;padding:16px;border-radius:12px;margin:18px 0;">
      <h3 style="margin:0 0 6px;color:#1B2A4A;font-size:15px;">Tracking details</h3>
      ${order.courierName ? `<p style="margin:2px 0;color:#555;">Courier: <strong>${order.courierName}</strong></p>` : ''}
      ${order.trackingNumber ? `<p style="margin:2px 0;color:#555;">Tracking ID: <strong>${order.trackingNumber}</strong></p>` : ''}
      ${order.trackingUrl ? `<p style="margin:10px 0 0;"><a href="${order.trackingUrl}" style="background:#F7931E;color:#fff;padding:10px 20px;border-radius:24px;text-decoration:none;font-weight:600;font-size:14px;">Track your parcel</a></p>` : ''}
    </div>` : '';

  const html = layout(`${heading} 📦`, `
    <p>Hi ${user.firstName},</p>
    <p>${message}</p>
    <p style="color:#555;">Order <strong>#${order.orderNumber}</strong></p>
    ${tracking}
    <div style="text-align:center;margin:26px 0;">
      <a href="${config.clientUrl}/track-order?order=${order.orderNumber}" style="background:#1B2A4A;color:#fff;padding:13px 26px;border-radius:28px;text-decoration:none;font-weight:600;">View order status</a>
    </div>
  `);

  return sendEmail({
    to: user.email,
    subject: `${heading} — Order #${order.orderNumber}`,
    html,
  });
};

/**
 * Order Confirmation Email
 */
export const sendOrderConfirmation = async (user, order) => {
  const itemsHtml = order.items.map((item) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #eee;">${item.name}</td>
      <td style="padding:12px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:12px;border-bottom:1px solid #eee;text-align:right;">₹${item.price.toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#fff;">
      <div style="background:#F7931E;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;">AniLiving</h1>
        <p style="color:#fff;margin:5px 0 0;opacity:.9;">Everything Your Pet Deserves.</p>
      </div>
      <div style="padding:30px;">
        <h2 style="color:#1B2A4A;margin-top:0;">Order Confirmed! 🎉</h2>
        <p>Hi ${user.firstName},</p>
        <p>Thank you for your order! Your order <strong>#${order.orderNumber}</strong> has been confirmed.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <thead>
            <tr style="background:#FFF8F0;">
              <th style="padding:12px;text-align:left;border-bottom:2px solid #F7931E;">Product</th>
              <th style="padding:12px;text-align:center;border-bottom:2px solid #F7931E;">Qty</th>
              <th style="padding:12px;text-align:right;border-bottom:2px solid #F7931E;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding:12px;text-align:right;font-weight:bold;">Total:</td>
              <td style="padding:12px;text-align:right;font-weight:bold;color:#F7931E;">₹${order.totalPrice.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="color:#666;">Payment: ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Paid via Razorpay'}</p>
        <div style="background:#FFF8F0;padding:20px;border-radius:12px;margin:20px 0;">
          <h3 style="margin-top:0;color:#1B2A4A;">Shipping Address</h3>
          <p style="margin:0;color:#666;">
            ${order.shippingAddress.fullName}<br/>
            ${order.shippingAddress.addressLine1}<br/>
            ${order.shippingAddress.addressLine2 ? order.shippingAddress.addressLine2 + '<br/>' : ''}
            ${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.pincode}
          </p>
        </div>
      </div>
      <div style="background:#1B2A4A;padding:20px;text-align:center;">
        <p style="color:#fff;margin:0;font-size:14px;">© ${new Date().getFullYear()} AniLiving. All rights reserved.</p>
      </div>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: `Order Confirmed #${order.orderNumber} — AniLiving`,
    html,
  });
};

/**
 * Password Reset Email
 */
export const sendPasswordResetEmail = async (user, resetUrl) => {
  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#fff;">
      <div style="background:#F7931E;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;">AniLiving</h1>
      </div>
      <div style="padding:30px;">
        <h2 style="color:#1B2A4A;margin-top:0;">Reset Your Password</h2>
        <p>Hi ${user.firstName},</p>
        <p>You requested a password reset. Click the button below to create a new password:</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${resetUrl}" style="background:#F7931E;color:#fff;padding:14px 28px;border-radius:30px;text-decoration:none;font-weight:600;">Reset Password</a>
        </div>
        <p style="color:#999;font-size:14px;">This link expires in 10 minutes. If you didn't request this, please ignore this email.</p>
      </div>
      <div style="background:#1B2A4A;padding:20px;text-align:center;">
        <p style="color:#fff;margin:0;font-size:14px;">© ${new Date().getFullYear()} AniLiving. All rights reserved.</p>
      </div>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Reset Your Password — AniLiving',
    html,
  });
};

/**
 * Welcome Email
 */
export const sendWelcomeEmail = async (user) => {
  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#fff;">
      <div style="background:#F7931E;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;">Welcome to AniLiving! 🐾</h1>
      </div>
      <div style="padding:30px;">
        <h2 style="color:#1B2A4A;margin-top:0;">Hey ${user.firstName}!</h2>
        <p>Welcome to AniLiving — your premium pet supplies destination. We're thrilled to have you!</p>
        <p>Start exploring our curated collection of pet products.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${config.clientUrl}" style="background:#F7931E;color:#fff;padding:14px 28px;border-radius:30px;text-decoration:none;font-weight:600;">Shop Now</a>
        </div>
      </div>
      <div style="background:#1B2A4A;padding:20px;text-align:center;">
        <p style="color:#fff;margin:0;font-size:14px;">© ${new Date().getFullYear()} AniLiving. All rights reserved.</p>
      </div>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Welcome to AniLiving! 🐾',
    html,
  });
};

export default sendEmail;
