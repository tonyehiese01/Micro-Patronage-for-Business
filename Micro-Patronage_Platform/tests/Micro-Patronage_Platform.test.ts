import { describe, it, expect, beforeEach } from 'vitest';

// Mock Clarity contract environment
const mockContract = {
  // Data variables
  platformFeeRate: 250, // 2.5%
  minPatronageAmount: 1000000, // 1 STX
  currentTimestamp: 0,
  paymentCounter: 0,
  
  // Data maps
  businesses: new Map(),
  patronageSubscriptions: new Map(),
  businessPatrons: new Map(),
  
  // Mock principals
  contractOwner: 'ST1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE',
  
  // Helper functions
  getCurrentTime() {
    return this.currentTimestamp;
  },
  
  incrementTimestamp() {
    this.currentTimestamp += 1;
  },
  
  getNextPaymentId() {
    const currentId = this.paymentCounter;
    this.paymentCounter += 1;
    return currentId;
  },
  
  daysToTimeUnits(days) {
    return days;
  },
  
  autoUpdateTimestamp() {
    this.incrementTimestamp();
    return true;
  },
  
  // Contract functions
  registerBusiness(sender, name, description, category) {
    const businessWallet = sender;
    const currentTime = this.getCurrentTime();
    const registrationId = this.getNextPaymentId();
    
    if (this.businesses.has(businessWallet)) {
      return { error: 'ERR_ALREADY_EXISTS' };
    }
    
    this.businesses.set(businessWallet, {
      name,
      description,
      category,
      wallet: businessWallet,
      isActive: true,
      totalReceived: 0,
      patronCount: 0,
      createdAt: currentTime,
      registrationId
    });
    
    this.autoUpdateTimestamp();
    return { ok: businessWallet };
  },
  
  updateBusiness(sender, name, description, category) {
    const businessData = this.businesses.get(sender);
    if (!businessData) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    this.businesses.set(sender, {
      ...businessData,
      name,
      description,
      category
    });
    
    return { ok: true };
  },
  
  createPatronage(sender, business, amount, frequencyDays) {
    const patron = sender;
    const businessData = this.businesses.get(business);
    
    if (!businessData) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    if (!businessData.isActive) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    if (amount < this.minPatronageAmount) {
      return { error: 'ERR_INVALID_AMOUNT' };
    }
    
    if (frequencyDays <= 0) {
      return { error: 'ERR_INVALID_AMOUNT' };
    }
    
    const subscriptionKey = `${patron}-${business}`;
    if (this.patronageSubscriptions.has(subscriptionKey)) {
      return { error: 'ERR_ALREADY_EXISTS' };
    }
    
    const currentTime = this.getCurrentTime();
    const frequencyUnits = this.daysToTimeUnits(frequencyDays);
    const subscriptionId = this.getNextPaymentId();
    
    this.patronageSubscriptions.set(subscriptionKey, {
      amount,
      frequency: frequencyUnits,
      lastPayment: 0,
      nextPayment: currentTime + frequencyUnits,
      totalPaid: 0,
      isActive: true,
      createdAt: currentTime,
      subscriptionId
    });
    
    // Update business-patron relationship
    const patronKey = `${business}-${patron}`;
    const existingRelation = this.businessPatrons.get(patronKey);
    
    if (existingRelation) {
      this.businessPatrons.set(patronKey, {
        ...existingRelation,
        subscriptionCount: existingRelation.subscriptionCount + 1
      });
    } else {
      this.businessPatrons.set(patronKey, {
        totalContributed: 0,
        subscriptionCount: 1,
        firstPatronage: currentTime
      });
    }
    
    this.autoUpdateTimestamp();
    return { ok: { patron, business } };
  },
  
  processPatronagePayment(sender, business) {
    const patron = sender;
    const subscriptionKey = `${patron}-${business}`;
    const subscription = this.patronageSubscriptions.get(subscriptionKey);
    const businessData = this.businesses.get(business);
    
    if (!subscription) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    if (!businessData) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    if (!subscription.isActive) {
      return { error: 'ERR_SUBSCRIPTION_INACTIVE' };
    }
    
    if (!businessData.isActive) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    const currentTime = this.getCurrentTime();
    if (subscription.nextPayment > currentTime) {
      return { error: 'ERR_UNAUTHORIZED' };
    }
    
    const paymentAmount = subscription.amount;
    const platformFee = Math.floor((paymentAmount * this.platformFeeRate) / 10000);
    const businessAmount = paymentAmount - platformFee;
    
    // Update subscription
    this.patronageSubscriptions.set(subscriptionKey, {
      ...subscription,
      lastPayment: currentTime,
      nextPayment: currentTime + subscription.frequency,
      totalPaid: subscription.totalPaid + paymentAmount
    });
    
    // Update business stats
    this.businesses.set(business, {
      ...businessData,
      totalReceived: businessData.totalReceived + businessAmount
    });
    
    // Update patron relationship
    const patronKey = `${business}-${patron}`;
    const existingRelation = this.businessPatrons.get(patronKey);
    
    if (existingRelation) {
      this.businessPatrons.set(patronKey, {
        ...existingRelation,
        totalContributed: existingRelation.totalContributed + paymentAmount
      });
    } else {
      this.businessPatrons.set(patronKey, {
        totalContributed: paymentAmount,
        subscriptionCount: 1,
        firstPatronage: currentTime
      });
    }
    
    this.autoUpdateTimestamp();
    return {
      ok: {
        amount: paymentAmount,
        businessReceived: businessAmount,
        platformFee
      }
    };
  },
  
  cancelSubscription(sender, business) {
    const subscriptionKey = `${sender}-${business}`;
    const subscription = this.patronageSubscriptions.get(subscriptionKey);
    
    if (!subscription) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    this.patronageSubscriptions.set(subscriptionKey, {
      ...subscription,
      isActive: false
    });
    
    return { ok: true };
  },
  
  reactivateSubscription(sender, business) {
    const subscriptionKey = `${sender}-${business}`;
    const subscription = this.patronageSubscriptions.get(subscriptionKey);
    
    if (!subscription) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    if (subscription.isActive) {
      return { error: 'ERR_ALREADY_EXISTS' };
    }
    
    const currentTime = this.getCurrentTime();
    this.patronageSubscriptions.set(subscriptionKey, {
      ...subscription,
      isActive: true,
      nextPayment: currentTime + subscription.frequency
    });
    
    this.autoUpdateTimestamp();
    return { ok: true };
  },
  
  makeOneTimePatronage(sender, business, amount) {
    const patron = sender;
    const businessData = this.businesses.get(business);
    
    if (!businessData) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    if (!businessData.isActive) {
      return { error: 'ERR_NOT_FOUND' };
    }
    
    if (amount < this.minPatronageAmount) {
      return { error: 'ERR_INVALID_AMOUNT' };
    }
    
    const platformFee = Math.floor((amount * this.platformFeeRate) / 10000);
    const businessAmount = amount - platformFee;
    const currentTime = this.getCurrentTime();
    
    // Update business stats
    this.businesses.set(business, {
      ...businessData,
      totalReceived: businessData.totalReceived + businessAmount
    });
    
    // Update patron relationship
    const patronKey = `${business}-${patron}`;
    const existingRelation = this.businessPatrons.get(patronKey);
    
    if (existingRelation) {
      this.businessPatrons.set(patronKey, {
        ...existingRelation,
        totalContributed: existingRelation.totalContributed + amount
      });
    } else {
      this.businessPatrons.set(patronKey, {
        totalContributed: amount,
        subscriptionCount: 0,
        firstPatronage: currentTime
      });
    }
    
    this.autoUpdateTimestamp();
    return {
      ok: {
        amount,
        businessReceived: businessAmount,
        platformFee
      }
    };
  },
  
  // Read-only functions
  getBusiness(business) {
    return this.businesses.get(business) || null;
  },
  
  getSubscription(patron, business) {
    const subscriptionKey = `${patron}-${business}`;
    return this.patronageSubscriptions.get(subscriptionKey) || null;
  },
  
  getPatronRelationship(business, patron) {
    const patronKey = `${business}-${patron}`;
    return this.businessPatrons.get(patronKey) || null;
  },
  
  isPaymentDue(patron, business) {
    const subscription = this.getSubscription(patron, business);
    if (!subscription) return false;
    
    return subscription.isActive && subscription.nextPayment <= this.getCurrentTime();
  },
  
  calculatePaymentBreakdown(amount) {
    const platformFee = Math.floor((amount * this.platformFeeRate) / 10000);
    const businessAmount = amount - platformFee;
    
    return {
      totalAmount: amount,
      businessReceives: businessAmount,
      platformFee
    };
  },
  
  // Reset function for tests
  reset() {
    this.platformFeeRate = 250;
    this.minPatronageAmount = 1000000;
    this.currentTimestamp = 0;
    this.paymentCounter = 0;
    this.businesses.clear();
    this.patronageSubscriptions.clear();
    this.businessPatrons.clear();
  }
};

describe('Micro-Patronage Smart Contract', () => {
  const businessOwner = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
  const patron1 = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
  const patron2 = 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC';
  
  beforeEach(() => {
    mockContract.reset();
  });

  describe('Business Registration', () => {
    it('should register a new business successfully', () => {
      const result = mockContract.registerBusiness(
        businessOwner,
        'Coffee Corner',
        'Local coffee shop serving artisan coffee',
        'Food & Beverage'
      );
      
      expect(result.ok).toBe(businessOwner);
      
      const business = mockContract.getBusiness(businessOwner);
      expect(business.name).toBe('Coffee Corner');
      expect(business.description).toBe('Local coffee shop serving artisan coffee');
      expect(business.category).toBe('Food & Beverage');
      expect(business.isActive).toBe(true);
      expect(business.totalReceived).toBe(0);
      expect(business.patronCount).toBe(0);
    });

    it('should prevent duplicate business registration', () => {
      mockContract.registerBusiness(
        businessOwner,
        'Coffee Corner',
        'Local coffee shop',
        'Food & Beverage'
      );
      
      const result = mockContract.registerBusiness(
        businessOwner,
        'Another Business',
        'Different description',
        'Retail'
      );
      
      expect(result.error).toBe('ERR_ALREADY_EXISTS');
    });

    it('should update business information', () => {
      mockContract.registerBusiness(
        businessOwner,
        'Coffee Corner',
        'Local coffee shop',
        'Food & Beverage'
      );
      
      const result = mockContract.updateBusiness(
        businessOwner,
        'Premium Coffee Corner',
        'Premium local coffee shop serving artisan coffee',
        'Premium Food'
      );
      
      expect(result.ok).toBe(true);
      
      const business = mockContract.getBusiness(businessOwner);
      expect(business.name).toBe('Premium Coffee Corner');
      expect(business.description).toBe('Premium local coffee shop serving artisan coffee');
      expect(business.category).toBe('Premium Food');
    });
  });

  describe('Patronage Subscriptions', () => {
    beforeEach(() => {
      mockContract.registerBusiness(
        businessOwner,
        'Coffee Corner',
        'Local coffee shop',
        'Food & Beverage'
      );
    });

    it('should create a patronage subscription successfully', () => {
      const result = mockContract.createPatronage(
        patron1,
        businessOwner,
        2000000, // 2 STX
        7 // 7 days
      );
      
      expect(result.ok.patron).toBe(patron1);
      expect(result.ok.business).toBe(businessOwner);
      
      const subscription = mockContract.getSubscription(patron1, businessOwner);
      expect(subscription.amount).toBe(2000000);
      expect(subscription.frequency).toBe(7);
      expect(subscription.isActive).toBe(true);
      expect(subscription.totalPaid).toBe(0);
    });

    it('should reject subscription with amount below minimum', () => {
      const result = mockContract.createPatronage(
        patron1,
        businessOwner,
        500000, // 0.5 STX (below minimum)
        7
      );
      
      expect(result.error).toBe('ERR_INVALID_AMOUNT');
    });

    it('should reject subscription with zero frequency', () => {
      const result = mockContract.createPatronage(
        patron1,
        businessOwner,
        2000000,
        0 // Invalid frequency
      );
      
      expect(result.error).toBe('ERR_INVALID_AMOUNT');
    });

    it('should reject subscription for non-existent business', () => {
      const result = mockContract.createPatronage(
        patron1,
        'ST1NONEXISTENT',
        2000000,
        7
      );
      
      expect(result.error).toBe('ERR_NOT_FOUND');
    });

    it('should prevent duplicate subscriptions', () => {
      mockContract.createPatronage(patron1, businessOwner, 2000000, 7);
      
      const result = mockContract.createPatronage(patron1, businessOwner, 3000000, 14);
      
      expect(result.error).toBe('ERR_ALREADY_EXISTS');
    });
  });

  describe('Payment Processing', () => {
    beforeEach(() => {
      mockContract.registerBusiness(businessOwner, 'Coffee Corner', 'Local coffee shop', 'Food & Beverage');
      mockContract.createPatronage(patron1, businessOwner, 2000000, 7);
    });

    it('should process patronage payment when due', () => {
      // Fast forward time to make payment due
      mockContract.currentTimestamp = 8;
      
      const result = mockContract.processPatronagePayment(patron1, businessOwner);
      
      expect(result.ok.amount).toBe(2000000);
      expect(result.ok.businessReceived).toBe(1950000); // 2000000 - 2.5% fee
      expect(result.ok.platformFee).toBe(50000);
      
      const subscription = mockContract.getSubscription(patron1, businessOwner);
      expect(subscription.totalPaid).toBe(2000000);
      expect(subscription.lastPayment).toBe(8);
      expect(subscription.nextPayment).toBe(15); // 8 + 7 days
      
      const business = mockContract.getBusiness(businessOwner);
      expect(business.totalReceived).toBe(1950000);
    });

    it('should reject payment when not due yet', () => {
      // Payment not due yet (created at time 1, due at time 8)
      mockContract.currentTimestamp = 5;
      
      const result = mockContract.processPatronagePayment(patron1, businessOwner);
      
      expect(result.error).toBe('ERR_UNAUTHORIZED');
    });

    it('should reject payment for inactive subscription', () => {
      mockContract.cancelSubscription(patron1, businessOwner);
      mockContract.currentTimestamp = 8;
      
      const result = mockContract.processPatronagePayment(patron1, businessOwner);
      
      expect(result.error).toBe('ERR_SUBSCRIPTION_INACTIVE');
    });
  });

  describe('One-time Patronage', () => {
    beforeEach(() => {
      mockContract.registerBusiness(businessOwner, 'Coffee Corner', 'Local coffee shop', 'Food & Beverage');
    });

    it('should process one-time patronage payment', () => {
      const result = mockContract.makeOneTimePatronage(patron1, businessOwner, 5000000);
      
      expect(result.ok.amount).toBe(5000000);
      expect(result.ok.businessReceived).toBe(4875000); // 5000000 - 2.5% fee
      expect(result.ok.platformFee).toBe(125000);
      
      const business = mockContract.getBusiness(businessOwner);
      expect(business.totalReceived).toBe(4875000);
      
      const patronRelation = mockContract.getPatronRelationship(businessOwner, patron1);
      expect(patronRelation.totalContributed).toBe(5000000);
      expect(patronRelation.subscriptionCount).toBe(0);
    });

    it('should reject one-time payment below minimum', () => {
      const result = mockContract.makeOneTimePatronage(patron1, businessOwner, 500000);
      
      expect(result.error).toBe('ERR_INVALID_AMOUNT');
    });
  });

  describe('Subscription Management', () => {
    beforeEach(() => {
      mockContract.registerBusiness(businessOwner, 'Coffee Corner', 'Local coffee shop', 'Food & Beverage');
      mockContract.createPatronage(patron1, businessOwner, 2000000, 7);
    });

    it('should cancel subscription', () => {
      const result = mockContract.cancelSubscription(patron1, businessOwner);
      
      expect(result.ok).toBe(true);
      
      const subscription = mockContract.getSubscription(patron1, businessOwner);
      expect(subscription.isActive).toBe(false);
    });

    it('should reactivate cancelled subscription', () => {
      mockContract.cancelSubscription(patron1, businessOwner);
      mockContract.currentTimestamp = 10;
      
      const result = mockContract.reactivateSubscription(patron1, businessOwner);
      
      expect(result.ok).toBe(true);
      
      const subscription = mockContract.getSubscription(patron1, businessOwner);
      expect(subscription.isActive).toBe(true);
      expect(subscription.nextPayment).toBe(17); // 10 + 7 days
    });

    it('should reject reactivating active subscription', () => {
      const result = mockContract.reactivateSubscription(patron1, businessOwner);
      
      expect(result.error).toBe('ERR_ALREADY_EXISTS');
    });
  });

  describe('Payment Status Checking', () => {
    beforeEach(() => {
      mockContract.registerBusiness(businessOwner, 'Coffee Corner', 'Local coffee shop', 'Food & Beverage');
      mockContract.createPatronage(patron1, businessOwner, 2000000, 7);
    });

    it('should correctly identify when payment is due', () => {
      mockContract.currentTimestamp = 8;
      
      const isDue = mockContract.isPaymentDue(patron1, businessOwner);
      
      expect(isDue).toBe(true);
    });

    it('should correctly identify when payment is not due', () => {
      mockContract.currentTimestamp = 5;
      
      const isDue = mockContract.isPaymentDue(patron1, businessOwner);
      
      expect(isDue).toBe(false);
    });
  });

  describe('Payment Breakdown Calculation', () => {
    it('should calculate correct payment breakdown', () => {
      const breakdown = mockContract.calculatePaymentBreakdown(10000000);
      
      expect(breakdown.totalAmount).toBe(10000000);
      expect(breakdown.businessReceives).toBe(9750000); // 10000000 - 2.5%
      expect(breakdown.platformFee).toBe(250000);
    });

    it('should handle small amounts correctly', () => {
      const breakdown = mockContract.calculatePaymentBreakdown(1000000);
      
      expect(breakdown.totalAmount).toBe(1000000);
      expect(breakdown.businessReceives).toBe(975000);
      expect(breakdown.platformFee).toBe(25000);
    });
  });

  describe('Multiple Patrons and Businesses', () => {
    const business2 = 'ST2BUSINESS2';
    
    beforeEach(() => {
      mockContract.registerBusiness(businessOwner, 'Coffee Corner', 'Local coffee shop', 'Food & Beverage');
      mockContract.registerBusiness(business2, 'Book Store', 'Local bookstore', 'Retail');
    });

    it('should handle multiple patrons for one business', () => {
      mockContract.createPatronage(patron1, businessOwner, 2000000, 7);
      mockContract.createPatronage(patron2, businessOwner, 3000000, 14);
      
      const subscription1 = mockContract.getSubscription(patron1, businessOwner);
      const subscription2 = mockContract.getSubscription(patron2, businessOwner);
      
      expect(subscription1.amount).toBe(2000000);
      expect(subscription2.amount).toBe(3000000);
      expect(subscription1.frequency).toBe(7);
      expect(subscription2.frequency).toBe(14);
    });

    it('should handle one patron supporting multiple businesses', () => {
      mockContract.createPatronage(patron1, businessOwner, 2000000, 7);
      mockContract.createPatronage(patron1, business2, 1500000, 30);
      
      const subscription1 = mockContract.getSubscription(patron1, businessOwner);
      const subscription2 = mockContract.getSubscription(patron1, business2);
      
      expect(subscription1.amount).toBe(2000000);
      expect(subscription2.amount).toBe(1500000);
    });

    it('should track patron relationships correctly', () => {
      mockContract.makeOneTimePatronage(patron1, businessOwner, 5000000);
      mockContract.createPatronage(patron1, businessOwner, 2000000, 7);
      
      const relation = mockContract.getPatronRelationship(businessOwner, patron1);
      
      expect(relation.totalContributed).toBe(5000000); // Only one-time payment so far
      expect(relation.subscriptionCount).toBe(1);
    });
  });
});