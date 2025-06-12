;; Micro-Patronage for Businesses Smart Contract
;; Allows customers to make small recurring payments to support local businesses

;; Constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-found (err u101))
(define-constant err-already-exists (err u102))
(define-constant err-insufficient-funds (err u103))
(define-constant err-unauthorized (err u104))
(define-constant err-invalid-amount (err u105))
(define-constant err-subscription-inactive (err u106))

;; Data Variables
(define-data-var platform-fee-rate uint u250) ;; 2.5% in basis points
(define-data-var min-patronage-amount uint u1000000) ;; 1 STX minimum
(define-data-var current-timestamp uint u0) ;; Manual timestamp tracking
(define-data-var payment-counter uint u0) ;; Unique payment ID counter

;; Data Maps
(define-map businesses
  principal
  {
    name: (string-ascii 64),
    description: (string-ascii 256),
    category: (string-ascii 32),
    wallet: principal,
    is-active: bool,
    total-received: uint,
    patron-count: uint,
    created-at: uint,
    registration-id: uint
  }
)

(define-map patronage-subscriptions
  {patron: principal, business: principal}
  {
    amount: uint,
    frequency: uint, ;; payment interval in days
    last-payment: uint,
    next-payment: uint,
    total-paid: uint,
    is-active: bool,
    created-at: uint,
    subscription-id: uint
  }
)

(define-map business-patrons
  {business: principal, patron: principal}
  {
    total-contributed: uint,
    subscription-count: uint,
    first-patronage: uint
  }
)

;; Helper Functions
(define-private (get-current-time)
  (var-get current-timestamp))

(define-private (increment-timestamp)
  (var-set current-timestamp (+ (var-get current-timestamp) u1)))

(define-private (get-next-payment-id)
  (let ((current-id (var-get payment-counter)))
    (var-set payment-counter (+ current-id u1))
    current-id))

(define-private (days-to-time-units (days uint))
  ;; Convert days to our time units (assuming 1 unit = 1 day for simplicity)
  days)

;; Update timestamp (called by contract owner or automatically)
(define-public (update-timestamp)
  (begin
    (increment-timestamp)
    (ok (get-current-time))))

;; Private function for automatic timestamp updates
(define-private (auto-update-timestamp)
  (begin
    (increment-timestamp)
    true))

;; Business Registration
(define-public (register-business (name (string-ascii 64)) 
                                 (description (string-ascii 256))
                                 (category (string-ascii 32)))
  (let ((business-wallet tx-sender)
        (current-time (get-current-time))
        (registration-id (get-next-payment-id)))
    (asserts! (is-none (map-get? businesses business-wallet)) err-already-exists)
    (map-set businesses business-wallet
      {
        name: name,
        description: description,
        category: category,
        wallet: business-wallet,
        is-active: true,
        total-received: u0,
        patron-count: u0,
        created-at: current-time,
        registration-id: registration-id
      })
    (auto-update-timestamp)
    (ok business-wallet)))

;; Update Business Info
(define-public (update-business (name (string-ascii 64))
                               (description (string-ascii 256))
                               (category (string-ascii 32)))
  (let ((business-data (unwrap! (map-get? businesses tx-sender) err-not-found)))
    (map-set businesses tx-sender
      (merge business-data
        {
          name: name,
          description: description,
          category: category
        }))
    (ok true)))

;; Create Patronage Subscription
(define-public (create-patronage (business principal)
                                (amount uint)
                                (frequency-days uint)) ;; frequency in days
  (let (
    (patron tx-sender)
    (business-data (unwrap! (map-get? businesses business) err-not-found))
    (subscription-key {patron: patron, business: business})
    (current-time (get-current-time))
    (frequency-units (days-to-time-units frequency-days))
    (subscription-id (get-next-payment-id))
  )
    (asserts! (get is-active business-data) err-not-found)
    (asserts! (>= amount (var-get min-patronage-amount)) err-invalid-amount)
    (asserts! (> frequency-days u0) err-invalid-amount)
    (asserts! (is-none (map-get? patronage-subscriptions subscription-key)) err-already-exists)
    
    ;; Create subscription
    (map-set patronage-subscriptions subscription-key
      {
        amount: amount,
        frequency: frequency-units,
        last-payment: u0,
        next-payment: (+ current-time frequency-units),
        total-paid: u0,
        is-active: true,
        created-at: current-time,
        subscription-id: subscription-id
      })
    
    ;; Initialize or update business-patron relationship
    (let ((patron-key {business: business, patron: patron}))
      (match (map-get? business-patrons patron-key)
        existing-relation
          (map-set business-patrons patron-key
            (merge existing-relation
              {subscription-count: (+ (get subscription-count existing-relation) u1)}))
        (map-set business-patrons patron-key
          {
            total-contributed: u0,
            subscription-count: u1,
            first-patronage: current-time
          })))
    
    (auto-update-timestamp)
    (ok subscription-key)))

;; Process Patronage Payment
(define-public (process-patronage-payment (business principal))
  (let (
    (patron tx-sender)
    (subscription-key {patron: patron, business: business})
    (subscription (unwrap! (map-get? patronage-subscriptions subscription-key) err-not-found))
    (business-data (unwrap! (map-get? businesses business) err-not-found))
    (current-time (get-current-time))
  )
    (asserts! (get is-active subscription) err-subscription-inactive)
    (asserts! (get is-active business-data) err-not-found)
    (asserts! (<= (get next-payment subscription) current-time) err-unauthorized)
    
    (let (
      (payment-amount (get amount subscription))
      (platform-fee (/ (* payment-amount (var-get platform-fee-rate)) u10000))
      (business-amount (- payment-amount platform-fee))
    )
      ;; Transfer payment to business
      (try! (stx-transfer? business-amount patron (get wallet business-data)))
      
      ;; Transfer platform fee to contract owner
      (try! (stx-transfer? platform-fee patron contract-owner))
      
      ;; Update subscription
      (map-set patronage-subscriptions subscription-key
        (merge subscription
          {
            last-payment: current-time,
            next-payment: (+ current-time (get frequency subscription)),
            total-paid: (+ (get total-paid subscription) payment-amount)
          }))
      
      ;; Update business stats
      (map-set businesses business
        (merge business-data
          {
            total-received: (+ (get total-received business-data) business-amount)
          }))
      
      ;; Update patron relationship
      (let ((patron-key {business: business, patron: patron}))
        (match (map-get? business-patrons patron-key)
          existing-relation
            (map-set business-patrons patron-key
              (merge existing-relation
                {total-contributed: (+ (get total-contributed existing-relation) payment-amount)}))
          ;; This shouldn't happen if subscription exists, but handle it
          (map-set business-patrons patron-key
            {
              total-contributed: payment-amount,
              subscription-count: u1,
              first-patronage: current-time
            })))
      
      (auto-update-timestamp)
      (ok {amount: payment-amount, business-received: business-amount, platform-fee: platform-fee}))))

;; Cancel Subscription
(define-public (cancel-subscription (business principal))
  (let (
    (patron tx-sender)
    (subscription-key {patron: patron, business: business})
    (subscription (unwrap! (map-get? patronage-subscriptions subscription-key) err-not-found))
  )
    (map-set patronage-subscriptions subscription-key
      (merge subscription {is-active: false}))
    (ok true)))

;; Reactivate Subscription
(define-public (reactivate-subscription (business principal))
  (let (
    (patron tx-sender)
    (subscription-key {patron: patron, business: business})
    (subscription (unwrap! (map-get? patronage-subscriptions subscription-key) err-not-found))
    (current-time (get-current-time))
  )
    (asserts! (not (get is-active subscription)) err-already-exists)
    (map-set patronage-subscriptions subscription-key
      (merge subscription 
        {
          is-active: true,
          next-payment: (+ current-time (get frequency subscription))
        }))
    ;; Fixed: Call auto-update-timestamp directly instead of using try!
    (auto-update-timestamp)
    (ok true)))

;; One-time Patronage Payment
(define-public (make-one-time-patronage (business principal) (amount uint))
  (let (
    (patron tx-sender)
    (business-data (unwrap! (map-get? businesses business) err-not-found))
    (platform-fee (/ (* amount (var-get platform-fee-rate)) u10000))
    (business-amount (- amount platform-fee))
    (current-time (get-current-time))
  )
    (asserts! (get is-active business-data) err-not-found)
    (asserts! (>= amount (var-get min-patronage-amount)) err-invalid-amount)
    
    ;; Transfer payment to business
    (try! (stx-transfer? business-amount patron (get wallet business-data)))
    
    ;; Transfer platform fee to contract owner
    (try! (stx-transfer? platform-fee patron contract-owner))
    
    ;; Update business stats
    (map-set businesses business
      (merge business-data
        {
          total-received: (+ (get total-received business-data) business-amount)
        }))
    
    ;; Update or create patron relationship
    (let ((patron-key {business: business, patron: patron}))
      (match (map-get? business-patrons patron-key)
        existing-relation
          (map-set business-patrons patron-key
            (merge existing-relation
              {total-contributed: (+ (get total-contributed existing-relation) amount)}))
        (map-set business-patrons patron-key
          {
            total-contributed: amount,
            subscription-count: u0,
            first-patronage: current-time
          })))
    
    ;; Fixed: Remove try! and call auto-update-timestamp directly
    (auto-update-timestamp)
    (ok {amount: amount, business-received: business-amount, platform-fee: platform-fee})))

;; Admin Functions
(define-public (set-platform-fee-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (asserts! (<= new-rate u1000) err-invalid-amount) ;; Max 10%
    (var-set platform-fee-rate new-rate)
    (ok true)))

(define-public (set-min-patronage-amount (new-amount uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (var-set min-patronage-amount new-amount)
    (ok true)))

(define-public (deactivate-business (business principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (let ((business-data (unwrap! (map-get? businesses business) err-not-found)))
      (map-set businesses business
        (merge business-data {is-active: false}))
      (ok true))))

;; Read-only Functions
(define-read-only (get-business (business principal))
  (map-get? businesses business))

(define-read-only (get-subscription (patron principal) (business principal))
  (map-get? patronage-subscriptions {patron: patron, business: business}))

(define-read-only (get-patron-relationship (business principal) (patron principal))
  (map-get? business-patrons {business: business, patron: patron}))

(define-read-only (is-payment-due (patron principal) (business principal))
  (match (map-get? patronage-subscriptions {patron: patron, business: business})
    subscription
      (and 
        (get is-active subscription)
        (<= (get next-payment subscription) (get-current-time)))
    false))

(define-read-only (get-platform-fee-rate)
  (var-get platform-fee-rate))

(define-read-only (get-min-patronage-amount)
  (var-get min-patronage-amount))

(define-read-only (calculate-payment-breakdown (amount uint))
  (let (
    (platform-fee (/ (* amount (var-get platform-fee-rate)) u10000))
    (business-amount (- amount platform-fee))
  )
    {
      total-amount: amount,
      business-receives: business-amount,
      platform-fee: platform-fee
    }))

;; Get business statistics
(define-read-only (get-business-stats (business principal))
  (match (map-get? businesses business)
    business-data
      (ok {
        total-received: (get total-received business-data),
        patron-count: (get patron-count business-data),
        is-active: (get is-active business-data),
        created-at: (get created-at business-data)
      })
    err-not-found))

;; Check if user can make payment
(define-read-only (can-make-payment (patron principal) (business principal))
  (match (map-get? patronage-subscriptions {patron: patron, business: business})
    subscription
      (and
        (get is-active subscription)
        (<= (get next-payment subscription) (get-current-time))
        (match (map-get? businesses business)
          business-data (get is-active business-data)
          false))
    false))

;; Get current contract timestamp
(define-read-only (get-contract-time)
  (get-current-time))

;; Get time until next payment
(define-read-only (time-until-next-payment (patron principal) (business principal))
  (match (map-get? patronage-subscriptions {patron: patron, business: business})
    subscription
      (let ((current-time (get-current-time))
            (next-payment (get next-payment subscription)))
        (if (<= next-payment current-time)
          u0  ;; Payment is due now
          (- next-payment current-time)))
    u0))