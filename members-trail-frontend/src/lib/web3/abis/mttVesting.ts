// GENERATED FILE — do not hand-edit.
//
// Source : MLM-contracts/artifacts/contracts/MTTVesting.sol/MTTVesting.json
// Build  : Solidity 0.8.24, optimizer runs=200, evmVersion=paris.
// Command: npm run abi   (in MLM-contracts)
//
// Hand-editing an ABI is how the previous chain layer ended up matching no
// events at all: a wrong event signature is a wrong topic0, and getLogs then
// returns an empty array rather than an error.
export const mttVestingAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "beneficiary_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "token_",
        "type": "address"
      },
      {
        "internalType": "uint64",
        "name": "start_",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "cliffDuration_",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "vestingDuration_",
        "type": "uint64"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "to",
        "type": "address"
      }
    ],
    "name": "TokensReleased",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "beneficiary",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cliffDuration",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "releasable",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "release",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "released",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "schedule",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "beneficiary",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "start",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "cliffEnd",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "vestingEnd",
            "type": "uint64"
          },
          {
            "internalType": "uint256",
            "name": "total",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "released",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "releasable",
            "type": "uint256"
          }
        ],
        "internalType": "struct MTTVesting.Schedule",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "start",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "token",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalAllocation",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "timestamp",
        "type": "uint64"
      }
    ],
    "name": "vestedAmount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "vestingDuration",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
