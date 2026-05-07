# Pricing Route Architecture

## Tree

```text
apps/web/app/pricing
`-- page.tsx       # Public pricing strategy page derived from research/pricing.md
```

## Decisions

- Pricing is a public website route, not a merchant-console feature, because merchants must understand fees before login.
- The page codifies the adopted hybrid model: free monthly access with a 0.50% successful-checkout take rate, paid plans that buy down checkout fees, higher-fee operational workflows, and Zama confidential checkout as premium value.
- Fee tables are static product copy for the hackathon prototype; runtime billing enforcement is out of scope until account plans exist in the backend.
