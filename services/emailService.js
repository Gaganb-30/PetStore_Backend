import nodemailer from 'nodemailer';
import config from '../config/index.js';

/**
 * Email Service using Nodemailer
 * Handles all transactional emails: OTP, order confirmation, status updates, password reset, etc.
 * Uses AniLiving design system: Navy Blue (#0047ae / #002D72) + Bright Yellow (#FFD60A).
 */

// A single pooled transporter is reused for the life of the process.
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
// Shared email header and footer layout
// ---------------------------------------------------------------------------
const headerHtml = `
  <div style="background:#0047ae;padding:32px 24px;text-align:center;border-bottom:4px solid #FFD60A;">
    <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">AniLiving <span style="color:#FFD60A;">🐾</span></h1>
    <p style="color:#FFF3CC;margin:6px 0 0;font-size:13px;letter-spacing:0.5px;font-weight:500;">Everything Your Pet Deserves.</p>
  </div>
`;

const footerHtml = `
  <div style="background:#002D72;padding:22px;text-align:center;border-top:1px solid #1A5BC4;">
    <p style="color:#ffffff;margin:0;font-size:13px;opacity:0.9;">© ${new Date().getFullYear()} AniLiving. All rights reserved.</p>
  </div>
`;

/**
 * Send an OTP verification code via email.
 *
 * @param {string} email  Recipient email address
 * @param {string} otp    The 6-digit OTP code
 */
export const sendOtpEmail = async (email, otp) => {
  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
      ${headerHtml}
      <div style="padding:32px 28px;color:#222222;">
        <h2 style="color:#0047ae;margin-top:0;font-size:22px;font-weight:700;">Your verification code</h2>
        <p style="font-size:15px;color:#444444;line-height:1.5;">Use the code below to sign in to your AniLiving account:</p>
        <div style="text-align:center;margin:32px 0;">
          <div style="display:inline-block;background:#FFFBE6;padding:18px 36px;border-radius:14px;border:2px dashed #0047ae;box-shadow:0 4px 16px rgba(0,71,174,0.08);">
            <span style="display:block;font-size:38px;font-weight:800;letter-spacing:10px;color:#0047ae;font-family:'Consolas','Courier New',monospace;">${otp}</span>
          </div>
        </div>
        <p style="color:#666666;font-size:14px;line-height:1.5;background:#F0F5FF;padding:12px 16px;border-radius:8px;border-left:3px solid #0047ae;">
          ⏱️ This code is valid for <strong>5 minutes</strong>. If you didn't request this, you can safely ignore this email.
        </p>
      </div>
      ${footerHtml}
    </div>
  `;

  return sendEmail({
    to: email,
    subject: `${otp} — Your AniLiving verification code`,
    html,
    text: `Your AniLiving verification code is: ${otp}. It is valid for 5 minutes.`,
  });
};

// ---------------------------------------------------------------------------
// Shared layout helper
// ---------------------------------------------------------------------------
const layout = (title, body) => `
  <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
    ${headerHtml}
    <div style="padding:32px 28px;color:#222222;">
      <h2 style="color:#0047ae;margin-top:0;font-size:22px;font-weight:700;">${title}</h2>
      ${body}
    </div>
    ${footerHtml}
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
 * Order status update email — sent whenever an admin moves an order state.
 */
export const sendOrderStatusUpdate = async (user, order) => {
  const [heading, message] = STATUS_COPY[order.status] || ['Order update', 'Your order status has been updated.'];

  const tracking = order.trackingNumber || order.trackingUrl ? `
    <div style="background:#F0F5FF;border:1px solid #D0E1FD;border-left:4px solid #0047ae;padding:16px;border-radius:8px;margin:20px 0;">
      <h3 style="margin:0 0 6px;color:#0047ae;font-size:15px;font-weight:700;">Tracking details</h3>
      ${order.courierName ? `<p style="margin:2px 0;color:#555;">Courier: <strong>${order.courierName}</strong></p>` : ''}
      ${order.trackingNumber ? `<p style="margin:2px 0;color:#555;">Tracking ID: <strong>${order.trackingNumber}</strong></p>` : ''}
      ${order.trackingUrl ? `<p style="margin:12px 0 0;"><a href="${order.trackingUrl}" style="background:#FFD60A;color:#00378a;padding:10px 20px;border-radius:24px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">Track your parcel</a></p>` : ''}
    </div>` : '';

  const html = layout(`${heading} 📦`, `
    <p style="font-size:15px;">Hi ${user.firstName},</p>
    <p style="font-size:15px;color:#444;">${message}</p>
    <p style="color:#555;font-size:15px;">Order <strong>#${order.orderNumber}</strong></p>
    ${tracking}
    <div style="text-align:center;margin:28px 0;">
      <a href="${config.clientUrl}/track-order?order=${order.orderNumber}" style="background:#0047ae;color:#ffffff;padding:13px 28px;border-radius:28px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">View order status</a>
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
      <td style="padding:14px 12px;border-bottom:1px solid #E5E7EB;color:#222222;font-size:14px;">${item.name}</td>
      <td style="padding:14px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:#444444;font-size:14px;">${item.quantity}</td>
      <td style="padding:14px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:#222222;font-weight:600;font-size:14px;">₹${item.price.toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
      ${headerHtml}
      <div style="padding:32px 28px;color:#222222;">
        <h2 style="color:#0047ae;margin-top:0;font-size:22px;font-weight:700;">Order Confirmed! 🎉</h2>
        <p style="font-size:15px;line-height:1.5;">Hi ${user.firstName},</p>
        <p style="font-size:15px;color:#444444;line-height:1.5;">Thank you for your order! Your order <strong>#${order.orderNumber}</strong> has been confirmed.</p>
        
        <table style="width:100%;border-collapse:collapse;margin:24px 0;">
          <thead>
            <tr style="background:#F0F5FF;">
              <th style="padding:12px;text-align:left;border-bottom:2px solid #0047ae;color:#0047ae;font-size:14px;">Product</th>
              <th style="padding:12px;text-align:center;border-bottom:2px solid #0047ae;color:#0047ae;font-size:14px;">Qty</th>
              <th style="padding:12px;text-align:right;border-bottom:2px solid #0047ae;color:#0047ae;font-size:14px;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr style="background:#FFFBE6;">
              <td colspan="2" style="padding:14px 12px;text-align:right;font-weight:700;color:#00378a;font-size:15px;">Total:</td>
              <td style="padding:14px 12px;text-align:right;font-weight:800;color:#0047ae;font-size:17px;">₹${order.totalPrice.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="background:#F0F5FF;padding:12px 16px;border-radius:8px;margin-bottom:20px;">
          <p style="margin:0;color:#00378a;font-weight:600;font-size:14px;">
            💳 Payment: <span style="font-weight:normal;color:#333;">${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Paid via Online Payment'}</span>
          </p>
        </div>

        <div style="background:#FAFAFA;border:1px solid #E5E7EB;border-left:4px solid #FFD60A;padding:18px;border-radius:8px;margin:20px 0;">
          <h3 style="margin-top:0;margin-bottom:8px;color:#0047ae;font-size:15px;font-weight:700;">Delivery Address</h3>
          <p style="margin:0;color:#555555;font-size:14px;line-height:1.5;">
            <strong>${order.shippingAddress.fullName}</strong><br/>
            ${order.shippingAddress.addressLine1}<br/>
            ${order.shippingAddress.addressLine2 ? order.shippingAddress.addressLine2 + '<br/>' : ''}
            ${order.shippingAddress.city}, ${order.shippingAddress.state} — ${order.shippingAddress.pincode}
          </p>
        </div>

        <div style="text-align:center;margin:28px 0 10px;">
          <a href="${config.clientUrl}/track-order?order=${order.orderNumber}" style="background:#FFD60A;color:#00378a;padding:13px 30px;border-radius:28px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;box-shadow:0 4px 12px rgba(255,214,10,0.35);">Track Order</a>
        </div>
      </div>
      ${footerHtml}
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
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
      ${headerHtml}
      <div style="padding:32px 28px;color:#222222;">
        <h2 style="color:#0047ae;margin-top:0;font-size:22px;font-weight:700;">Reset Your Password</h2>
        <p style="font-size:15px;line-height:1.5;">Hi ${user.firstName},</p>
        <p style="font-size:15px;color:#444;line-height:1.5;">You requested a password reset. Click the button below to create a new password:</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${resetUrl}" style="background:#0047ae;color:#ffffff;padding:14px 30px;border-radius:30px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Reset Password</a>
        </div>
        <p style="color:#777;font-size:14px;line-height:1.5;">This link expires in 10 minutes. If you didn't request this, please ignore this email.</p>
      </div>
      ${footerHtml}
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
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
      ${headerHtml}
      <div style="padding:32px 28px;color:#222222;">
        <h2 style="color:#0047ae;margin-top:0;font-size:22px;font-weight:700;">Hey ${user.firstName}! 🐾</h2>
        <p style="font-size:15px;line-height:1.5;">Welcome to AniLiving — your premium pet supplies destination. We're thrilled to have you with us!</p>
        <p style="font-size:15px;color:#444;line-height:1.5;">Explore our curated collection of wholesome foods, toys, accessories, and grooming essentials.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${config.clientUrl}" style="background:#FFD60A;color:#00378a;padding:14px 32px;border-radius:30px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;box-shadow:0 4px 14px rgba(255,214,10,0.35);">Shop Now</a>
        </div>
      </div>
      ${footerHtml}
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Welcome to AniLiving! 🐾',
    html,
  });
};

export default sendEmail;
