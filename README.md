# Stellar Multi-Signature Wallet

A decentralized application (dapp) for managing Stellar accounts with multi-signature transaction capabilities.

## Features

- **Multi-Signature Support**: Configure and manage multi-signature accounts with custom thresholds
- **Wallet Integration**: Connect with popular Stellar wallets (Freighter, Ledger, WalletConnect, etc.)
- **Transaction Builder**: Create and submit various types of Stellar transactions
- **Asset Management**: View account balances and manage different assets
- **Network Support**: Switch between Stellar mainnet and testnet
- **XDR Processing**: Import and process transaction XDR data
- **Real-time Pricing**: Display asset values with live market data

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Blockchain**: Stellar Network
- **Wallet Kit**: Stellar Wallets Kit
- **UI Framework**: Tailwind CSS + shadcn/ui
- **Build Tool**: Vite

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

### Usage

1. **Connect Wallet**: Choose your preferred Stellar wallet to connect
2. **View Account**: Review your account balances, signers, and thresholds
3. **Configure Multi-sig**: Set up multi-signature requirements for enhanced security
4. **Build Transactions**: Create payments, asset operations, and other transactions
5. **Submit & Sign**: Submit transactions for signing by required parties

## Key Components

- **Account Overview**: Displays account details, balances, and signer information
- **Transaction Builder**: Interface for creating various transaction types
- **Multi-sig Configuration**: Tools for setting up multi-signature accounts
- **Payment Forms**: Simplified interfaces for asset transfers
- **Network Selector**: Switch between different Stellar networks

## Security

This dapp prioritizes security by:
- Supporting hardware wallets (Ledger)
- Enabling multi-signature configurations
- Providing transaction preview before signing
- Using established Stellar SDK libraries

Built for the Stellar ecosystem to provide secure and user-friendly multi-signature account management.