/**
 * paymentProvider.js
 * Phase 14: Unified Payment Provider Abstraction Layer
 *
 * Provides a polymorphic adapter interface for payment gateways.
 * - Primary implementation: Stripe UAE (StripePaymentProvider)
 * - Regional gateway readiness: Designed for pluggable adapters like Tap Payments (mada, Apple Pay)
 *   without breaking business rules or entitlements.
 */

class PaymentProvider {
  /**
   * @param {string} providerName
   */
  constructor(providerName = 'stripe') {
    this.name = providerName;
  }

  /**
   * Creates or retrieves a customer object in the gateway.
   * @param {{ userId: string, email: string, name?: string }} params
   * @returns {Promise<{ customerId: string, email: string }>}
   */
  async createCustomer(params) {
    throw new Error(`createCustomer not implemented for provider [${this.name}]`);
  }

  /**
   * Creates a Hosted Checkout Session for a subscription plan.
   * @param {{
   *   customerId: string,
   *   plan: { id: string, nameAr: string, nameEn: string, priceCents: number, currency: string, stripePriceId?: string },
   *   userId: string,
   *   successUrl: string,
   *   cancelUrl: string,
   *   trialDays?: number
   * }} params
   * @returns {Promise<{ sessionId: string, url: string }>}
   */
  async createCheckoutSession(params) {
    throw new Error(`createCheckoutSession not implemented for provider [${this.name}]`);
  }

  /**
   * Creates a self-service Customer Portal Session for managing cards and subscriptions.
   * @param {{ customerId: string, returnUrl: string }} params
   * @returns {Promise<{ portalUrl: string }>}
   */
  async createCustomerPortalSession(params) {
    throw new Error(`createCustomerPortalSession not implemented for provider [${this.name}]`);
  }

  /**
   * Verifies and constructs a verified webhook event from raw payload & signature.
   * @param {Buffer|string} rawBody
   * @param {string} signatureHeader
   * @param {string} secret
   * @returns {{ id: string, type: string, data: object, created: number }}
   */
  constructWebhookEvent(rawBody, signatureHeader, secret) {
    throw new Error(`constructWebhookEvent not implemented for provider [${this.name}]`);
  }

  /**
   * Cancels a subscription in the payment gateway.
   * @param {string} subscriptionId
   * @param {boolean} atPeriodEnd
   * @returns {Promise<{ id: string, status: string, cancelAtPeriodEnd: boolean }>}
   */
  async cancelSubscription(subscriptionId, atPeriodEnd = true) {
    throw new Error(`cancelSubscription not implemented for provider [${this.name}]`);
  }
}

let activeProvider = null;

function setPaymentProvider(provider) {
  activeProvider = provider;
}

function getPaymentProvider() {
  if (!activeProvider) {
    const { StripePaymentProvider } = require('./stripeProvider');
    activeProvider = new StripePaymentProvider();
  }
  return activeProvider;
}

module.exports = {
  PaymentProvider,
  setPaymentProvider,
  getPaymentProvider,
};
