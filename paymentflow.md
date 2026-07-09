MARKETPLACE DB (crm-marketplace-standard)
┌─────────────────────────────────────────────────────────────┐
│ oauthclients      _id/appId = 6a42b01a904c53a589aae692        │
│                   isPaidApp:true  externalBilling:false       │
│                   webhookUrl: …/webhooks/helmdesk             │
│ oauthpaymentplans Starter _id=6a46ab8380… billingPlanId=      │
│                   lc_plan_07559668-…                          │
│ oauthlocations    location=SH94xxRJPErKIwjmZnCX  company=amXJ… │
│ oauthpayments     paymentPlan=6a46ab8380…(Starter)            │
│                   subscriptionId = sub_zero_44465bca…         │
│                   amount=0  paymentStatus=COMPLETE            │
│                   meta.isAgencyPaying=true                    │
└───────────────┬─────────────────────────────────────────────┘
                │  subscriptionId (sub_zero_)
                ▼
RESELLING DB (revex)
┌─────────────────────────────────────────────────────────────┐
│ reselling-subscriptions (LOCATION)                            │
│   subscriptionId = sub_zero_44465bca…  amount=0  $0 placeholder│
│   purchaseStyle = COMPANY_DIRECT_PURCHASE   events:[]         │
│   companySubscriptionId = sub_1Tr1SMFpU9DlKp7RJqFRgx6E ──┐    │
└─────────────────────────────────────────────────────────┼────┘
                                                           ▼
┌─────────────────────────────────────────────────────────────┐
│ reselling-subscriptions (COMPANY)  ← REAL MONEY               │
│   subscriptionId = sub_1Tr1SMFpU9DlKp7RJqFRgx6E (Stripe)      │
│   amount=1  paymentStatus=COMPLETE  meta.status=ACTIVE        │
│   meta.lastInvoice = in_1Tr1SMFpU9DlKp7RDkjTAZCG              │
│   meta.lastInvoiceEventStatus = "paid"  ← you paid this       │
│   beneficiaries[0] = LOCATION SH94xxRJPErKIwjmZnCX            │
└─────────────────────────────────────────────────────────────┘
                                                           │
                          Stripe invoice in_1Tr1… = PAID ──┘



