# Pricing Route Architecture

## Tree

```text
apps/web/app/pricing
`-- page.tsx       # Public pricing strategy page derived from research/pricing.md
```

## Decisions

- Pricing is a public website route, not a merchant-console feature, because merchants must understand fees before login.
- The page codifies the adopted hybrid model: free monthly access, paid plans that buy down checkout fees, higher-fee operational workflows, and Zama confidential checkout as premium value.
- Plan fees and prices render from the generated local contract manifest; marketing copy cannot become a second fee source beside Solidity.
