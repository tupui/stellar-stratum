# Stellar-Stratum: User Flow Documentation

> **Complete documentation of all user flows with diagrams**

---

## 🏠 **Landing Page**

```mermaid
flowchart TD
  Start[User visits app] --> Landing[Landing Page]
  Landing --> Connect[Connect Wallet]
  Landing --> Airgap[Air-gapped Signer]
  Connect --> Wallet[Wallet Selection]
  Wallet --> Manual[Manual Address Entry]
  Wallet --> Domain[Soroban Domains]
  Wallet --> Freighter[Freighter Extension]
  Wallet --> xBull[xBull Wallet]
  Wallet --> Ledger[Ledger Hardware]
```

---

## 🔗 **Wallet Connection Flow**

```mermaid
sequenceDiagram
  participant User
  participant App
  participant Wallet
  participant Horizon

  User->>App: Click "Connect Wallet"
  App->>User: Show wallet options
  User->>App: Select wallet type
  App->>Wallet: Request connection
  Wallet-->>App: Return public key
  App->>Horizon: Load account data
  Horizon-->>App: Account info & balances
  App->>User: Show dashboard
```

---

## 💰 **Dashboard Overview**

```mermaid
flowchart TD
  Dashboard[Account Dashboard] --> Balances[Balances Section - Expandable]
  Dashboard --> Activity[Activity Section - Expandable]
  Dashboard --> Multisig[Multisig Section - Expandable]
  Dashboard --> Transaction[Initiate Transaction Button]
  
  Balances --> Assets[Asset List with Real-time Prices]
  Balances --> Prices[40+ Fiat Currency Support]
  Balances --> Total[Portfolio Value Calculation]
  Balances --> Refresh[Auto-refresh Every 30s]
  
  Activity --> History[Transaction History with Filters]
  Activity --> Chart[Balance Trend Chart - Fixed Date Issues]
  Activity --> Filters[Direction, Category, Asset Filters]
  Activity --> Export[Export Transaction Data]
  
  Multisig --> Config[Multisig Configuration Builder]
  Multisig --> Signers[Signer Management & Weights]
  Multisig --> Thresholds[Threshold Settings (Low/Med/High)]
  Multisig --> Validation[Real-time Validation & Warnings]
```

---

## 🔄 **Transaction Building Flow**

```mermaid
flowchart TD
  Start[Initiate Transaction] --> Builder[Transaction Builder]
  Builder --> Payment[Payment Tab]
  Builder --> Import[Import Tab]
  Builder --> Multisig[Multisig Tab]
  
  Payment --> AddOp[Add Operation]
  AddOp --> Dest[Set Destination]
  Dest --> Asset[Select Asset]
  Asset --> Amount[Set Amount]
  Amount --> Bundle[Bundle Operation]
  Bundle --> MoreOps{More Operations?}
  MoreOps -->|Yes| AddOp
  MoreOps -->|No| Build[Build Transaction]
  
  Import --> XDR[XDR Input]
  Import --> Refractor[Refractor ID]
  XDR --> Parse[Parse XDR]
  Refractor --> Pull[Pull Transaction]
  
  Multisig --> Config[Configure Signers]
  Config --> Thresholds[Set Thresholds]
  Thresholds --> BuildMultisig[Build Multisig Transaction]
```

---

## 🔐 **Transaction Signing Flow**

```mermaid
sequenceDiagram
  participant User
  participant App
  participant Validator
  participant Signer
  participant Refractor

  User->>App: Build Transaction
  App->>Validator: Show Transaction Verification (Auto-expanded)
  Validator->>User: Display transaction hash & XDR details
  User->>Validator: Verify hash matches signing device
  User->>App: Proceed to signing
  App->>Signer: Request signature (Fixed wallet ID issues)
  Signer-->>App: Return signed XDR
  App->>Refractor: Submit for coordination
  Refractor-->>App: Return transaction ID
  App->>User: Show success modal with navigation
  User->>App: Close modal → Return to dashboard
```

---

## 📱 **Multisig Coordination Flow**

```mermaid
flowchart TD
  Signer1[Signer 1] --> Build[Build Transaction]
  Build --> Mode{Coordination Mode}
  
  Mode -->|Online| Refractor[Refractor Integration]
  Mode -->|Offline| Airgap[Air-gapped Mode]
  
  Refractor --> Submit[Submit to Refractor]
  Submit --> QR[QR Code Generation]
  Submit --> Share[Share Options]
  
  Share --> Email[Email]
  Share --> WhatsApp[WhatsApp]
  Share --> Telegram[Telegram]
  Share --> CopyLink[Copy Link]
  
  Airgap --> QR2[QR Code for Offline]
  
  QR --> Signer2[Signer 2]
  Email --> Signer2
  WhatsApp --> Signer2
  Telegram --> Signer2
  CopyLink --> Signer2
  QR2 --> Signer2
  
  Signer2 --> Scan[Scan QR Code]
  Scan --> Verify[Verify Transaction]
  Verify --> Sign[Sign Transaction]
  Sign --> SubmitSig[Submit Signature]
  
  SubmitSig --> Threshold{Threshold Met?}
  Threshold -->|Yes| Execute[Execute Transaction]
  Threshold -->|No| Wait[Wait for More Signatures]
```

---

## 🔒 **Account Merging Flow**

```mermaid
flowchart TD
  Start[Start Transaction] --> Op1[Operation 1: Remove Non-XLM Assets]
  Op1 --> Bundle1[Bundle Operation 1]
  Bundle1 --> Op2[Operation 2: XLM Transaction]
  Op2 --> CheckEmpty{All Non-XLM Empty?}
  CheckEmpty -->|Yes| MergeBtn[Merge Account Button Appears]
  CheckEmpty -->|No| NormalFlow[Normal Transaction Flow]
  MergeBtn --> Warnings[Account Closure Warnings]
  Warnings --> AutoCalc[Auto-calculate All Remaining Funds]
  AutoCalc --> TrustlineOps[Generate Trustline Operations]
  TrustlineOps --> ComplexXDR[Complex XDR with Multiple Op Types]
  ComplexXDR --> SignFlow[Signature Collection]
```

---

## 🌐 **Network & Currency Flow**

```mermaid
flowchart TD
  Network[Network Selection] --> Mainnet[Mainnet]
  Network --> Testnet[Testnet]
  
  Mainnet --> Horizon1[Horizon Mainnet]
  Mainnet --> RPC1[Soroban RPC Mainnet]
  Mainnet --> Lab1[Stellar Lab Mainnet]
  
  Testnet --> Horizon2[Horizon Testnet]
  Testnet --> RPC2[Soroban RPC Testnet]
  Testnet --> Lab2[Stellar Lab Testnet]
  
  Currency[Fiat Currency] --> USD[USD]
  Currency --> EUR[EUR]
  Currency --> GBP[GBP]
  Currency --> JPY[JPY]
  Currency --> CAD[CAD]
  Currency --> AUD[AUD]
  Currency --> CHF[CHF]
  Currency --> CNY[CNY]
  Currency --> Others[40+ Currencies via FX Oracle]
  
  USD --> Prices[Price Conversion]
  EUR --> Prices
  GBP --> Prices
  JPY --> Prices
  CAD --> Prices
  AUD --> Prices
  CHF --> Prices
  CNY --> Prices
  Others --> Prices
```

---

## 🔍 **Address Book Flow**

```mermaid
sequenceDiagram
  participant User
  participant App
  participant Horizon
  participant Cache

  User->>App: Open Address Book
  App->>Cache: Check cached entries
  Cache-->>App: Return cached data
  App->>User: Show recent addresses
  
  alt Cache Miss or Expired
    App->>Horizon: Fetch transaction history
    Horizon-->>App: Return transactions
    App->>App: Extract addresses
    App->>Cache: Update cache
    App->>User: Show updated addresses
  end
  
  User->>App: Select address
  App->>User: Populate destination field
```

---

## 📊 **Price & Oracle Flow**

```mermaid
sequenceDiagram
  participant App
  participant Cache
  participant Reflector
  participant Kraken

  App->>Cache: Check price cache
  Cache-->>App: Return cached prices
  
  alt Cache Miss
    App->>Reflector: Fetch current prices
    Reflector-->>App: Return price data
    App->>Cache: Update cache
  end
  
  App->>Kraken: Fetch historical data
  Kraken-->>App: Return historical prices
  App->>App: Calculate portfolio value
  App->>App: Update UI with prices
```

---

## 🛡️ **Security Verification Flow**

```mermaid
flowchart TD
  Transaction[Transaction Built] --> Hash[Generate Hash]
  Hash --> Display[Display Hash in Transaction Verification]
  Display --> Mode{Device Mode?}
  
  Mode -->|Online| StellarLab[Stellar Lab Link Available]
  Mode -->|Offline| OfflineOnly[Local Verification Only - No Stellar Lab]
  
  StellarLab --> SigningDevice[Signing Device Display]
  OfflineOnly --> SigningDevice
  
  User[User] --> Compare[Compare Hashes Across Devices]
  Compare --> Match{Hash Matches?}
  Match -->|Yes| Proceed[Proceed with Signing]
  Match -->|No| Stop[STOP - Do Not Sign]
  
  Proceed --> Sign[Sign Transaction]
  Stop --> Alert[Show Security Alert]
  
  Sign --> Success[Success Modal]
  Success --> Navigate[Auto-navigate to Dashboard]
```

---

## 📱 **Mobile & Responsive Flow**

```mermaid
flowchart TD
  Device[Device Detection] --> Desktop[Desktop]
  Device --> Mobile[Mobile]
  Device --> Tablet[Tablet]
  
  Desktop --> FullUI[Full UI Layout]
  Mobile --> CompactUI[Compact UI Layout - Fixed Button Margins]
  Tablet --> AdaptiveUI[Adaptive UI Layout]
  
  CompactUI --> Touch[Touch Optimized]
  CompactUI --> Responsive[Responsive Design]
  CompactUI --> QR[QR Code Integration]
  CompactUI --> Margins[Proper Button Margins - No Full Width]
  
  FullUI --> Keyboard[Keyboard Navigation]
  FullUI --> Mouse[Mouse Interactions]
  FullUI --> MultiColumn[Multi-column Layout]
```

---

## 📈 **Chart & Data Visualization Flow**

```mermaid
flowchart TD
  Data[Transaction Data] --> Validation[Date Validation]
  Validation --> Filter[Filter Invalid Dates]
  Filter --> Aggregate[Smart Aggregation]
  
  Aggregate --> Range{Time Range?}
  Range -->|7D| Hourly[12-hour intervals]
  Range -->|30D| Daily[2-day intervals]
  Range -->|90D| Weekly[1-week intervals]
  Range -->|1Y/All| Monthly[1-month intervals]
  
  Hourly --> Format1[MMM dd format]
  Daily --> Format1
  Weekly --> Format2[MMM yyyy format]
  Monthly --> Format2
  
  Format1 --> Ticks1[Up to 7 ticks]
  Format2 --> Ticks2[Up to 4-5 ticks]
  
  Ticks1 --> Display[Clean X-axis Display]
  Ticks2 --> Display
  
  Display --> NoOverlap[No Date Overlap]
  Display --> Readable[Always Readable]
```

---

## 🔄 **Error Handling Flow**

```mermaid
flowchart TD
  Error[Error Occurs] --> Type[Determine Error Type]
  Type --> Network[Network Error]
  Type --> Validation[Validation Error]
  Type --> Security[Security Error]
  Type --> Transaction[Transaction Error]
  
  Network --> Retry[Retry with Backoff]
  Validation --> UserMessage[Show User Message]
  Security --> Alert[Security Alert]
  Transaction --> Verify[Verify Transaction]
  
  Retry --> Success{Success?}
  Success -->|Yes| Continue[Continue Flow]
  Success -->|No| Fallback[Fallback Action]
  
  UserMessage --> UserAction[User Action Required]
  Alert --> Stop[Stop Operation]
  Verify --> Correct[Correct Transaction]
```

---

## 🎯 **Key User Journeys**

### **Journey 1: First-time User**
1. Visit app → Connect wallet → View dashboard with expandable sections → Learn features

### **Journey 2: Regular Transaction**
1. Dashboard → Initiate transaction → Build payment → Verify with Stellar Lab → Sign → Success modal → Auto-return to dashboard

### **Journey 3: Multisig Coordination**
1. Build transaction → Share QR/Email/WhatsApp/Telegram → Collect signatures → Execute → Success modal

### **Journey 4: Account Management**
1. View balances → Check activity with readable chart → Configure multisig → Manage signers

### **Journey 5: Account Closure**
1. Build transaction → Remove all assets → Merge account → Final XLM transfer

### **Journey 6: Air-gapped Signing**
1. Scan QR code → Verify transaction locally (no Stellar Lab) → Sign → Generate signature QR

### **Journey 7: Chart Analysis**
1. View activity → Select time range → See clean, readable chart with proper date formatting → Analyze trends

---

