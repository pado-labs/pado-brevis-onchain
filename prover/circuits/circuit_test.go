package age

import (
	"context"
	"math/big"
	"testing"

	"github.com/brevis-network/brevis-sdk/sdk"
	"github.com/brevis-network/brevis-sdk/test"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

func TestCircuit(t *testing.T) {
	app, err := sdk.NewBrevisApp()
	check(err)
	ec, err := ethclient.Dial("https://bsc-dataseed.binance.org/")
	check(err)

	txHash := common.HexToHash(
		"1ccc982ececcabdbf820ba59f41ec5443efb8b855cc48c4de454ece868afbee3")
	tx, _, err := ec.TransactionByHash(context.Background(), txHash)
	check(err)
	receipt, err := ec.TransactionReceipt(context.Background(), txHash)
	check(err)
	from, err := types.Sender(types.NewLondonSigner(tx.ChainId()), tx)
	check(err)

	gtc := big.NewInt(0)
	gasFeeCap := big.NewInt(0)
	if tx.Type() == types.LegacyTxType {
		gtc = tx.GasPrice()
	} else {
		gtc = tx.GasTipCap()
		gasFeeCap = tx.GasFeeCap()
	}

	app.AddTransaction(sdk.TransactionData{
		Hash:                txHash,
		ChainId:             tx.ChainId(),
		BlockNum:            receipt.BlockNumber,
		Nonce:               tx.Nonce(),
		GasTipCapOrGasPrice: gtc,
		GasFeeCap:           gasFeeCap,
		GasLimit:            tx.Gas(),
		From:                from,
		To:                  *tx.To(),
		Value:               tx.Value(),
	})

	guest := &AppCircuit{}
	guestAssignment := &AppCircuit{}

	circuitInput, err := app.BuildCircuitInput(guest)
	check(err)

	test.ProverSucceeded(t, guest, guestAssignment, circuitInput)
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
