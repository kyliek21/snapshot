import gql from 'graphql-tag';
import {
  ApolloClient,
  createHttpLink,
  DocumentNode,
  InMemoryCache
} from '@apollo/client/core';
import { ref } from 'vue';
import { pin } from '@snapshot-labs/pineapple';
import { BigNumberish } from '@ethersproject/bignumber';
import { getInstance } from '@snapshot-labs/lock/plugins/vue3';
import { sendTransaction } from '@snapshot-labs/snapshot.js/src/utils';
import { useTxStatus } from '@/composables/useTxStatus';
import ABI from './abi.json';

const boostApolloClient = new ApolloClient({
  cache: new InMemoryCache({
    addTypename: false
  }),
  defaultOptions: {
    query: {
      fetchPolicy: 'no-cache'
    }
  }
});

const GUARD_URL = 'https://boost-guard.mktcode.uber.space';
const CONTRACT_ADDRESS = '0xaf8b6af86044821eed74e49057de62fb5c48e061';
const BOOSTS_QUERY = gql`
  query Boosts($tag: String!) {
    boosts(where: { tag: $tag }) {
      id
      balance
      strategyURI
      token {
        name
        symbol
        decimals
      }
      start
      end
      claims {
        id
        recipient
        amount
      }
    }
  }
`;

export function useBoost() {
  const { pendingCount } = useTxStatus();

  const boosts = ref<Record<string, any>[]>([]);
  const loadingBoosts = ref(true);

  async function requestClaimReceipt(
    boostId: BigNumberish,
    recipient: string,
    amount: BigNumberish
  ) {
    const init = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'get_receipt',
        params: {
          boostId,
          recipient,
          amount
        },
        id: null
      })
    };

    const res = await fetch(GUARD_URL, init).then(res => res.json());

    if (res.result.sig) return res.result;

    return null;
  }

  async function loadBoosts(
    proposalId: string,
    chainId: number,
    account: string
  ) {
    loadingBoosts.value = true;

    const res = await queryBoostSubgraph(
      BOOSTS_QUERY,
      { tag: proposalId },
      chainId
    );

    boosts.value = res.data.boosts;

    if (account) {
      for (const boost of boosts.value) {
        boost.receipt = await requestClaimReceipt(
          boost.id,
          account,
          '1000000000000000000'
        );
      }
    }

    loadingBoosts.value = false;
  }

  async function depositTokens(boostId: BigNumberish, amount: BigNumberish) {
    const tx = await sendTransaction(
      getInstance().web3,
      CONTRACT_ADDRESS,
      ABI,
      'depositTokens',
      [boostId, amount]
    );
    pendingCount.value++;
    await tx.wait();
    pendingCount.value--;
  }

  async function claimTokens(boost: any) {
    const tx = await sendTransaction(
      getInstance().web3,
      CONTRACT_ADDRESS,
      ABI,
      'claimTokens',
      [boost.receipt.data.message, boost.receipt.sig]
    );
    pendingCount.value++;
    await tx.wait();
    pendingCount.value--;
  }

  function getClaim(boost: any, account: string) {
    return boost.claims.find(
      c => c.recipient.toLowerCase() === account.toLowerCase()
    );
  }

  function getClaimTxLink(claim: any, chainId: number) {
    const txId = claim.id.split('-')[0];

    const explorerUrls: string[] = [];
    explorerUrls[1] = `https://etherscan.io/tx/${txId}`;
    explorerUrls[4] = `https://rinkeby.etherscan.io/tx/${txId}`;

    return explorerUrls[chainId];
  }

  async function pinStrategy(strategy: any) {
    const receipt = await pin(strategy);
    console.log(receipt);
  }

  async function queryBoostSubgraph(
    query: DocumentNode,
    variables: any,
    chainId: number
  ) {
    const apiUrls: string[] = [];
    apiUrls[1] = `https://api.thegraph.com/subgraphs/name/mktcode/boost`;
    apiUrls[4] = `https://api.thegraph.com/subgraphs/name/mktcode/boost`;

    boostApolloClient.setLink(createHttpLink({ uri: apiUrls[chainId] }));

    const res = await boostApolloClient.query({ query, variables });

    return res;
  }

  return {
    loadBoosts,
    boosts,
    loadingBoosts,
    depositTokens,
    claimTokens,
    getClaim,
    getClaimTxLink,
    pinStrategy,
    queryBoostSubgraph
  };
}