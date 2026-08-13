import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

// MockUSDC ABI — just the mint function
const MOCK_USDC_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export async function POST(req: Request) {
  try {
    const { address } = await req.json() as { address?: string };
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    const rpc     = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const privKey = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
    const usdcAddr = process.env.MOCK_USDC_ADDRESS as `0x${string}` | undefined;

    if (!privKey || !usdcAddr) {
      // On Vercel without env vars: return success with mock balance only
      return NextResponse.json({ ok: true, amount: 50, chain: "mock" });
    }

    const account = privateKeyToAccount(privKey);
    const wallet  = createWalletClient({ account, chain: anvil, transport: http(rpc) });

    const hash = await wallet.writeContract({
      address: usdcAddr,
      abi: MOCK_USDC_ABI,
      functionName: "mint",
      args: [address as `0x${string}`, parseUnits("50", 6)],
    });

    return NextResponse.json({ ok: true, amount: 50, hash, chain: "anvil" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
