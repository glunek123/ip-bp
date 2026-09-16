# 源码符号与常量索引

固定版本、模块编号和解释边界见 [INVENTORY.md](INVENTORY.md)。行号为原文件物理行（1 起）。本附录是全文阅读后的机械漏项索引，不是完整语义提取或已批准需求。

源码：[app.js](../../../demo/app.js)。模块按代码区域初步归属；跨模块函数以主职责为准，模块提取时复核。顶层 const 不代表不可变业务枚举；对象属性仍可修改。

## 函数与显式 window 函数

| 模块 | 符号                           | 起行  | 止行  |
| ---- | ------------------------------ | ----- | ----- |
| M00  | operatorStyle                  | 24    | 27    |
| M00  | leadPlatformsOf                | 54    | 56    |
| M00  | toast                          | 411   | 422   |
| M00  | modalHeadSlot                  | 428   | 439   |
| M00  | openModal                      | 440   | 476   |
| M00  | closeModal                     | 477   | 482   |
| M00  | confirmModal                   | 483   | 494   |
| M00  | infringeList                   | 500   | 503   |
| M00  | normalizeInfringe              | 522   | 533   |
| M00  | multiSelectHTML                | 534   | 551   |
| M00  | infringeTags                   | 553   | 557   |
| M00  | closeAllMsel                   | 558   | 564   |
| M00  | toggleMsel                     | 565   | 569   |
| M00  | mselSync                       | 570   | 583   |
| M00  | formModal                      | 587   | 664   |
| M00  | formFilePicked                 | 668   | 688   |
| M00  | fillAssetFormFromDoc           | 690   | 699   |
| M00  | splitDefendant                 | 717   | 721   |
| M00  | platformOf                     | 724   | 727   |
| M00  | shopOf                         | 728   | 731   |
| M00  | custNameOf                     | 735   | 735   |
| M00  | shopIdOf                       | 737   | 741   |
| M00  | amtCell                        | 742   | 742   |
| M00  | judgeAmtOf                     | 744   | 744   |
| M00  | closeAmtOf                     | 746   | 746   |
| M00  | lawyerOf                       | 748   | 753   |
| M00  | judgeOf                        | 756   | 760   |
| M00  | seedOf                         | 764   | 769   |
| M00  | rngOf                          | 770   | 778   |
| M00  | productPool                    | 845   | 852   |
| M00  | normBlank                      | 872   | 875   |
| M00  | caseLog                        | 884   | 926   |
| M00  | preserveFeeSeed                | 933   | 941   |
| M00  | preservePremiumSeed            | 942   | 945   |
| M00  | caseExtras                     | 949   | 1032  |
| M00  | customerExtras                 | 1060  | 1084  |
| M00  | selfHolder                     | 1087  | 1089  |
| M00  | defaultState                   | 1091  | 1101  |
| M00  | save                           | 1107  | 1123  |
| M00  | load                           | 1124  | 1175  |
| M00  | resetDemo                      | 1176  | 1193  |
| M02  | lawyerMenu                     | 1205  | 1214  |
| M02  | pickLawyer                     | 1216  | 1227  |
| M02  | seedLawyerSettle               | 1254  | 1258  |
| M02  | filteredCases                  | 1408  | 1451  |
| M02  | advFilterActive                | 1454  | 1457  |
| M02  | syncCaseFilterBtn              | 1459  | 1463  |
| M02  | openCaseFilter                 | 1465  | 1470  |
| M02  | applyCaseFilterPanel           | 1471  | 1481  |
| M02  | clearCaseFilter                | 1482  | 1493  |
| M02  | cut2                           | 1498  | 1503  |
| M02  | renderCases                    | 1507  | 1543  |
| M02  | toggleSelAll                   | 1546  | 1553  |
| M02  | colPrefsOf                     | 1572  | 1578  |
| M02  | applyColPrefs                  | 1579  | 1589  |
| M02  | openColPrefs                   | 1590  | 1609  |
| M03  | notaryColPrefsOf               | 1630  | 1636  |
| M03  | applyNotaryColPrefs            | 1637  | 1647  |
| M03  | openNotaryColPrefs             | 1648  | 1667  |
| M02  | emptyRow                       | 1669  | 1672  |
| M02  | filteredCustomers              | 1674  | 1681  |
| M02  | renderCustomers                | 1683  | 1704  |
| M02  | renderFilterCounts             | 1707  | 1736  |
| M02  | defendantRowHTML               | 1741  | 1781  |
| M02  | syncDefendantKind              | 1782  | 1786  |
| M02  | addDefendantRow                | 1787  | 1793  |
| M02  | removeDefendantRow             | 1794  | 1799  |
| M02  | renumberDefendantRows          | 1800  | 1803  |
| M02  | supplementDefendants           | 1805  | 1817  |
| M02  | submitSupplementDefendants     | 1819  | 1850  |
| M02  | caseStageForm                  | 1852  | 1917  |
| M00  | docNamesOf                     | 1931  | 1934  |
| M00  | docRootOf                      | 1936  | 1939  |
| M00  | docUploadHTML                  | 1941  | 1969  |
| M00  | docFileCardsHTML               | 1972  | 1984  |
| M00  | docRefresh                     | 1986  | 1994  |
| M00  | docFilePicked                  | 1996  | 2000  |
| M00  | docApplyNames                  | 2001  | 2016  |
| M00  | docDragOver                    | 2017  | 2017  |
| M00  | docDragLeave                   | 2018  | 2018  |
| M00  | docDrop                        | 2019  | 2026  |
| M00  | docRemoveFile                  | 2028  | 2033  |
| M00  | docDownload                    | 2035  | 2037  |
| M02  | stageUploadHTML                | 2041  | 2047  |
| M02  | stageFilePicked                | 2048  | 2057  |
| M02  | settleCalcHTML                 | 2063  | 2075  |
| M02  | settleCalcLine                 | 2077  | 2087  |
| M02  | recalcCustSettle               | 2089  | 2095  |
| M02  | refreshSettleRow               | 2097  | 2106  |
| M02  | uploadFilingDocs               | 2109  | 2123  |
| M02  | removeFilingDoc                | 2125  | 2130  |
| M02  | authDocsOf                     | 2134  | 2140  |
| M02  | clearFileField                 | 2143  | 2148  |
| M02  | refundRowHTML                  | 2155  | 2168  |
| M02  | refundsHTML                    | 2169  | 2175  |
| M02  | addRefundRow                   | 2176  | 2179  |
| M02  | updateRefundTotal              | 2180  | 2186  |
| M02  | collectRefunds                 | 2187  | 2196  |
| M02  | refundsReadonlyHTML            | 2199  | 2208  |
| M02  | judgeDocRecognize              | 2211  | 2229  |
| M02  | judgeUpdateSubmit              | 2232  | 2273  |
| M02  | openSecondInstanceChoice       | 2276  | 2296  |
| M02  | secondInstanceToExec           | 2298  | 2306  |
| M02  | appellantDefendantsOf          | 2308  | 2311  |
| M02  | syncAppellantRole              | 2313  | 2316  |
| M02  | secondInstanceEnterForm        | 2318  | 2368  |
| M02  | secondAppellantIsPlaintiff     | 2373  | 2377  |
| M02  | secondProgressOf               | 2380  | 2383  |
| M02  | hasSecondInstance              | 2385  | 2388  |
| M02  | secondUpdateSubmit             | 2392  | 2408  |
| M02  | openSecondUpdateChoice         | 2410  | 2431  |
| M02  | secondApplyVals                | 2434  | 2437  |
| M02  | secondUpdateRetrial            | 2440  | 2451  |
| M02  | openSecondResultForm           | 2456  | 2510  |
| M02  | secondUpdateAffirmForm         | 2511  | 2511  |
| M02  | secondUpdateChangeForm         | 2512  | 2512  |
| M02  | payProofPicked                 | 2531  | 2538  |
| M02  | syncPayProofUI                 | 2540  | 2552  |
| M02  | applyPayRowLimit               | 2559  | 2568  |
| M02  | syncPayRowLimit                | 2569  | 2577  |
| M02  | payHeadHTML                    | 2585  | 2588  |
| M02  | payRowHTML                     | 2589  | 2600  |
| M02  | renumberPayRows                | 2602  | 2607  |
| M02  | removePayRow                   | 2608  | 2614  |
| M02  | paymentsHTML                   | 2615  | 2621  |
| M02  | addPayRow                      | 2622  | 2628  |
| M02  | updatePayTotal                 | 2629  | 2634  |
| M02  | submitCaseStage                | 2636  | 2741  |
| M02  | syncHearingCalendar            | 2744  | 2760  |
| M02  | syncSecondHearingCalendar      | 2763  | 2778  |
| M02  | defendantNames                 | 2783  | 2788  |
| M02  | defendantTipHTML               | 2791  | 2809  |
| M02  | holderName                     | 2811  | 2813  |
| M02  | hasDefendantInfo               | 2820  | 2822  |
| M02  | caseCta                        | 2825  | 2831  |
| M02  | runCaseCta                     | 2833  | 2838  |
| M02  | caseActionBtns                 | 2840  | 2845  |
| M02  | draftTextOf                    | 2849  | 2852  |
| M02  | defendantBlockOf               | 2856  | 2865  |
| M02  | fillDraftTemplate              | 2867  | 2878  |
| M02  | draftDefName                   | 2880  | 2883  |
| M00  | draftDocHTML                   | 2885  | 2888  |
| M00  | crc32                          | 2900  | 2904  |
| M00  | makeZip                        | 2906  | 2941  |
| M00  | downloadBytes                  | 2942  | 2948  |
| M02  | exportDraftsBatch              | 2951  | 2959  |
| M02  | openDraftTemplatePrompt        | 2961  | 2980  |
| M02  | runExportDrafts                | 2981  | 3004  |
| M00  | unzipList                      | 3008  | 3036  |
| M00  | unzipRead                      | 3037  | 3053  |
| M00  | draftAmountFromBytes           | 3055  | 3068  |
| M00  | matchCaseForDraftName          | 3070  | 3083  |
| M02  | uploadDraftsBatch              | 3085  | 3106  |
| M02  | readDraftZip                   | 3107  | 3140  |
| M02  | openDraftUploadResult          | 3141  | 3155  |
| M02  | bulkConfirmDrafts              | 3158  | 3192  |
| M02  | execDocContent                 | 3195  | 3203  |
| M02  | bulkDownloadExecDocs           | 3204  | 3226  |
| M02  | downloadSealDocsZip            | 3229  | 3246  |
| M02  | batchSealDocsZip               | 3249  | 3258  |
| M02  | mailDraftsBatch                | 3261  | 3289  |
| M02  | bulkMailExecBatch              | 3292  | 3320  |
| M02  | execCaseNoFromText             | 3324  | 3327  |
| M02  | matchCaseForExecText           | 3329  | 3351  |
| M02  | applyExecDoc                   | 3353  | 3358  |
| M02  | uploadExecDocsBatch            | 3360  | 3382  |
| M02  | readExecZip                    | 3383  | 3408  |
| M02  | readExecSingleFile             | 3409  | 3422  |
| M02  | openExecUploadResult           | 3423  | 3437  |
| M02  | batchSealDownload              | 3440  | 3451  |
| M02  | bulkUploadHTML                 | 3453  | 3461  |
| M02  | bulkFilePicked                 | 3462  | 3468  |
| M02  | bulkFilingCaseRow              | 3469  | 3481  |
| M02  | bulkFilingFillAll              | 3482  | 3491  |
| M02  | bulkFilingBatch                | 3492  | 3532  |
| M02  | casesBatchAction               | 3536  | 3545  |
| M02  | syncCasesBatchBtn              | 3547  | 3584  |
| M02  | syncCasesExportTip             | 3587  | 3594  |
| M02  | syncCaseSubstageBar            | 3615  | 3627  |
| M02  | stageFilterScope               | 3636  | 3640  |
| M02  | syncCasesStageCaret            | 3641  | 3647  |
| M02  | toggleStageFilter              | 3648  | 3666  |
| M02  | closeStageFilter               | 3667  | 3670  |
| M02  | renderStageFilterPanel         | 3671  | 3688  |
| M02  | toggleStageFilterKey           | 3689  | 3694  |
| M02  | clearStageFilter               | 3695  | 3698  |
| M02  | syncStageFilterUI              | 3700  | 3706  |
| M05  | stageOfCase                    | 3722  | 3725  |
| M05  | evOkStatus                     | 3729  | 3729  |
| M05  | evOkStage                      | 3730  | 3730  |
| M05  | evDateOf                       | 3735  | 3735  |
| M05  | evHearAt                       | 3736  | 3736  |
| M05  | evCloseAt                      | 3737  | 3737  |
| M05  | evDateInRange                  | 3738  | 3746  |
| M05  | evOkDate                       | 3747  | 3750  |
| M05  | evOkLawyer                     | 3755  | 3759  |
| M05  | filteredEvList                 | 3761  | 3761  |
| M05  | evSelKey                       | 3763  | 3763  |
| M05  | evLawyerOf                     | 3765  | 3765  |
| M05  | evStageCountOf                 | 3769  | 3778  |
| M05  | evStageCountOfAll              | 3780  | 3788  |
| M05  | toggleEvStageFilter            | 3789  | 3807  |
| M05  | closeEvStageFilter             | 3808  | 3811  |
| M05  | renderEvStageFilterPanel       | 3812  | 3826  |
| M05  | toggleEvStageFilterKey         | 3827  | 3832  |
| M05  | clearEvStageFilter             | 3833  | 3836  |
| M05  | syncEvStageFilterUI            | 3838  | 3848  |
| M02  | archPayRowHTML                 | 3859  | 3861  |
| M02  | addArchPayRow                  | 3862  | 3869  |
| M02  | openBulkFinalizeArchive        | 3881  | 3911  |
| M02  | openBulkArchive                | 3913  | 3957  |
| M02  | batchStageAction               | 3960  | 3976  |
| M02  | pushCaseTimeline               | 3978  | 3981  |
| M02  | openCaseArchive                | 3983  | 4016  |
| M02  | advanceCaseStage               | 4018  | 4030  |
| M02  | autoFlowCases                  | 4033  | 4047  |
| M02  | seedStageDocs                  | 4060  | 4118  |
| M02  | seedSecondInstanceDemo         | 4123  | 4136  |
| M02  | fillStageDemoCases             | 4138  | 4207  |
| M02  | renderCaseStageNav             | 4209  | 4240  |
| M04  | feeStatusOptions               | 4258  | 4260  |
| M04  | feeDirection                   | 4261  | 4261  |
| M04  | feeDirOf                       | 4263  | 4266  |
| M04  | expStatusOfFee                 | 4269  | 4269  |
| M04  | feeStatusOfExp                 | 4271  | 4271  |
| M04  | pushFeeFromSource              | 4278  | 4296  |
| M04  | pushFeeForNotary               | 4299  | 4303  |
| M04  | syncExpFromFee                 | 4305  | 4310  |
| M04  | syncFeeFromExp                 | 4312  | 4316  |
| M04  | feeSeed                        | 4317  | 4339  |
| M04  | feeColPrefsOf                  | 4358  | 4364  |
| M04  | applyFeeColPrefs               | 4365  | 4376  |
| M04  | openFeeColPrefs                | 4377  | 4396  |
| M04  | mergeSampleFeeRows             | 4407  | 4437  |
| M04  | feeFiltered                    | 4438  | 4455  |
| M04  | applyFeeFilter                 | 4456  | 4464  |
| M04  | clearFeeFilter                 | 4465  | 4472  |
| M04  | toggleFeeSel                   | 4473  | 4477  |
| M04  | toggleAllFeeSel                | 4478  | 4484  |
| M04  | selectedFees                   | 4485  | 4488  |
| M04  | updateFeeSelUI                 | 4489  | 4500  |
| M04  | feeCaseOf                      | 4502  | 4502  |
| M04  | feeCaseCells                   | 4503  | 4513  |
| M04  | feeStatusCell                  | 4514  | 4520  |
| M04  | setFeeStatus                   | 4521  | 4527  |
| M04  | renderFees                     | 4529  | 4588  |
| M04  | feeId                          | 4589  | 4589  |
| M04  | casePickKeys                   | 4593  | 4597  |
| M04  | casePickLabel                  | 4598  | 4598  |
| M04  | casePickerHTML                 | 4599  | 4608  |
| M04  | casePickMenu                   | 4609  | 4623  |
| M04  | casePickChoose                 | 4624  | 4635  |
| M04  | casePickRead                   | 4636  | 4639  |
| M04  | syncFeeStatusOptions           | 4641  | 4650  |
| M04  | syncExpenseFromFee             | 4652  | 4660  |
| M04  | addFee                         | 4662  | 4702  |
| M04  | bulkLaunchFee                  | 4704  | 4722  |
| M04  | bulkDelFee                     | 4724  | 4743  |
| M04  | amtFilled                      | 4748  | 4753  |
| M04  | openPayFeeInit                 | 4756  | 4801  |
| M02  | renderKPI                      | 4803  | 4825  |
| M02  | renderAll                      | 4827  | 4850  |
| M02  | curCase                        | 4855  | 4855  |
| M02  | openCase                       | 4857  | 4863  |
| M02  | renderCaseDetail               | 4865  | 4908  |
| M02  | preserveFeeOf                  | 4913  | 4916  |
| M02  | openPreserve                   | 4917  | 4948  |
| M02  | renderTimelineOf               | 4950  | 4967  |
| M02  | openTimelineAdd                | 4972  | 5004  |
| M02  | addTimelineRecord              | 5005  | 5013  |
| M04  | expStatusOf                    | 5021  | 5024  |
| M04  | expenseRowsHTML                | 5028  | 5057  |
| M04  | expenseTotalOf                 | 5058  | 5058  |
| M04  | allExpensesOf                  | 5060  | 5063  |
| M04  | mergedExpenseItem              | 5066  | 5071  |
| M04  | mergedExpenseStatus            | 5072  | 5076  |
| M04  | mergedExpenseNote              | 5078  | 5084  |
| M04  | mergedExpenseProof             | 5085  | 5097  |
| M04  | mergedExpenseClearProof        | 5098  | 5102  |
| M04  | mergedExpenseRemove            | 5103  | 5108  |
| M04  | renderExpenses                 | 5110  | 5139  |
| M04  | pickExpenseProof               | 5143  | 5159  |
| M04  | clearExpenseProof              | 5160  | 5168  |
| M04  | syncFeeProof                   | 5170  | 5174  |
| M04  | setExpenseStatus               | 5176  | 5182  |
| M04  | setExpenseNote                 | 5187  | 5195  |
| M04  | syncFeeNote                    | 5197  | 5201  |
| M04  | feeNoteOf                      | 5204  | 5212  |
| M02  | renderLinks                    | 5214  | 5239  |
| M02  | applyOverrides                 | 5242  | 5247  |
| M02  | initInlineEdit                 | 5248  | 5261  |
| M10  | openCustomer                   | 5266  | 5271  |
| M10  | curCustomer                    | 5272  | 5272  |
| M10  | custSettlements                | 5277  | 5285  |
| M10  | settleBillText                 | 5287  | 5290  |
| M10  | renderCustSettlements          | 5291  | 5317  |
| M10  | exportCustStatement            | 5320  | 5330  |
| M10  | uploadCustContract             | 5333  | 5348  |
| M10  | setCustContractText            | 5351  | 5360  |
| M10  | renderCustContracts            | 5364  | 5379  |
| M10  | viewCustContract               | 5382  | 5391  |
| M10  | custManagerOptions             | 5394  | 5394  |
| M10  | setCustManager                 | 5395  | 5404  |
| M10  | custOperatorOptions            | 5407  | 5407  |
| M10  | setCustOperator                | 5408  | 5416  |
| M06  | fmtPct                         | 5421  | 5421  |
| M06  | clampPct                       | 5422  | 5422  |
| M06  | custFormula                    | 5423  | 5429  |
| M06  | pctFromFormula                 | 5431  | 5435  |
| M06  | custPctOf                      | 5436  | 5436  |
| M06  | custCoopFrom                   | 5439  | 5439  |
| M06  | custCoopTo                     | 5440  | 5440  |
| M06  | custInvoiceType                | 5441  | 5441  |
| M06  | custInvoiceSubject             | 5442  | 5442  |
| M06  | custTaxNo                      | 5443  | 5443  |
| M06  | custBank                       | 5444  | 5444  |
| M06  | settleTextOf                   | 5446  | 5450  |
| M06  | monthsLeftText                 | 5452  | 5459  |
| M06  | lawModeOf                      | 5465  | 5465  |
| M06  | lawSplitOf                     | 5466  | 5469  |
| M06  | lawAgreementOf                 | 5470  | 5473  |
| M06  | lawAmountOf                    | 5474  | 5479  |
| M06  | lawCondText                    | 5481  | 5486  |
| M06  | custOfCase                     | 5489  | 5494  |
| M06  | settleFigures                  | 5497  | 5516  |
| M06  | custSettleTip                  | 5518  | 5522  |
| M06  | lawSettleTip                   | 5523  | 5530  |
| M06  | activeSettleCase               | 5533  | 5535  |
| M06  | settleBaseOverride             | 5537  | 5541  |
| M06  | settlePanelEl                  | 5542  | 5542  |
| M06  | syncLawyerMode                 | 5544  | 5558  |
| M06  | settleEditorHTML               | 5560  | 5608  |
| M06  | settleEditFigures              | 5610  | 5629  |
| M06  | recalcSettleEdit               | 5631  | 5653  |
| M06  | onSettleAmountInput            | 5655  | 5659  |
| M06  | updateSettleEditLine           | 5660  | 5666  |
| M06  | toggleSettleEdit               | 5667  | 5673  |
| M06  | closeSettleEdit                | 5674  | 5678  |
| M06  | openSettleEditor               | 5680  | 5690  |
| M06  | applySettleEdit                | 5692  | 5730  |
| M06  | settleLogOf                    | 5736  | 5739  |
| M06  | settledOf                      | 5740  | 5742  |
| M06  | settleTotalOf                  | 5743  | 5746  |
| M06  | settleRemainOf                 | 5747  | 5749  |
| M06  | settleNextNth                  | 5750  | 5750  |
| M06  | settleLaunchBtn                | 5752  | 5764  |
| M06  | settleAmtCell                  | 5767  | 5781  |
| M06  | openSettleLaunch               | 5784  | 5828  |
| M06  | pushSettleRecord               | 5831  | 5853  |
| M06  | renderCustCta                  | 5856  | 5878  |
| M06  | safeRender                     | 5883  | 5885  |
| M10  | renderCustomerDetail           | 5887  | 5928  |
| M10  | renderCustKpi                  | 5934  | 5964  |
| M10  | wanToNum                       | 5967  | 5973  |
| M10  | renderContacts                 | 5975  | 5999  |
| M10  | assetTcls                      | 6007  | 6007  |
| M10  | assetStatusOf                  | 6009  | 6013  |
| M10  | fileHash                       | 6014  | 6014  |
| M10  | normDate                       | 6015  | 6019  |
| M10  | guessAssetType                 | 6020  | 6028  |
| M10  | assetDocRecognize              | 6030  | 6076  |
| M10  | renderAssets                   | 6078  | 6107  |
| M00  | toggleSubNav                   | 6124  | 6133  |
| M00  | syncSubNav                     | 6135  | 6145  |
| M00  | setCrumb                       | 6147  | 6154  |
| M00  | showView                       | 6156  | 6176  |
| M00  | goFees                         | 6179  | 6183  |
| M00  | subCrumbOf                     | 6185  | 6190  |
| M00  | toggleCasesSub                 | 6193  | 6203  |
| M00  | gotoCaseStage                  | 6204  | 6209  |
| M00  | syncCasesNav                   | 6210  | 6226  |
| M00  | switchTab                      | 6227  | 6230  |
| M02  | recalcCaseNo                   | 6234  | 6240  |
| M02  | newCase                        | 6242  | 6300  |
| M02  | mergedSourcesOf                | 6335  | 6335  |
| M02  | mergeShopLabel                 | 6337  | 6337  |
| M02  | nextMergeNotaryId              | 6339  | 6343  |
| M02  | mergeCases                     | 6345  | 6384  |
| M02  | mergeConfirmHTML               | 6386  | 6419  |
| M02  | readMergePicks                 | 6422  | 6448  |
| M02  | doMergeCases                   | 6450  | 6537  |
| M02  | caseDefRowHTML                 | 6545  | 6591  |
| M02  | addCaseDefRow                  | 6592  | 6598  |
| M02  | removeCaseDefRow               | 6599  | 6604  |
| M02  | renumberCaseDefRows            | 6605  | 6608  |
| M02  | readCaseDefendants             | 6610  | 6628  |
| M02  | editCard                       | 6633  | 6873  |
| M02  | deleteCase                     | 6875  | 6887  |
| M02  | pushLog                        | 6889  | 6896  |
| M02  | advanceStage                   | 6898  | 6908  |
| M02  | reopenCase                     | 6910  | 6916  |
| M04  | expenseRowHTML                 | 6922  | 6930  |
| M04  | addExpenseRow                  | 6931  | 6936  |
| M04  | readExpenseRows                | 6937  | 6943  |
| M04  | addExpense                     | 6944  | 6975  |
| M04  | removeExpense                  | 6976  | 6984  |
| M02  | removeLink                     | 6987  | 6991  |
| M10  | newCustomer                    | 6994  | 7031  |
| M10  | editCustomerCard               | 7035  | 7089  |
| M10  | deleteCustomer                 | 7092  | 7103  |
| M10  | addContact                     | 7105  | 7127  |
| M10  | editContact                    | 7128  | 7144  |
| M10  | removeContact                  | 7145  | 7149  |
| M10  | addAsset                       | 7151  | 7176  |
| M10  | editAsset                      | 7179  | 7208  |
| M10  | removeAsset                    | 7209  | 7213  |
| M10  | uploadAssetDoc                 | 7217  | 7244  |
| M10  | batchUploadAssets              | 7248  | 7268  |
| M10  | batchAssetPicked               | 7269  | 7289  |
| M10  | renderBatchAssetPreview        | 7290  | 7305  |
| M10  | batchAssetCommit               | 7306  | 7316  |
| M10  | renderHolders                  | 7319  | 7339  |
| M10  | addHolder                      | 7340  | 7360  |
| M10  | editHolder                     | 7361  | 7379  |
| M10  | removeHolder                   | 7380  | 7393  |
| M02  | toggleSel                      | 7396  | 7399  |
| M02  | updateBulk                     | 7400  | 7410  |
| M02  | bulkMatchLawyer                | 7413  | 7432  |
| M02  | openMatchLawyerForm            | 7435  | 7503  |
| M02  | bulkExport                     | 7505  | 7508  |
| M02  | bulkDelete                     | 7509  | 7520  |
| M02  | hasActiveFilter                | 7525  | 7532  |
| M02  | exportScope                    | 7534  | 7542  |
| M02  | exportCases                    | 7543  | 7547  |
| M02  | exportCSV                      | 7550  | 7565  |
| M02  | downloadCSV                    | 7568  | 7576  |
| M08  | exportReportsCSV               | 7578  | 7593  |
| M03  | exportNotaryCSV                | 7610  | 7618  |
| M10  | exportCustomers                | 7621  | 7627  |
| M06  | exportMonthBillsCSV            | 7629  | 7639  |
| M01  | leadTotalAmt                   | 7832  | 7834  |
| M01  | genLeadId                      | 7837  | 7851  |
| M01  | safeList                       | 7859  | 7859  |
| M01  | custList                       | 7860  | 7863  |
| M01  | stateIsLive                    | 7864  | 7864  |
| M01  | custOrdinalOf                  | 7865  | 7869  |
| M01  | dateDigitsOf                   | 7871  | 7878  |
| M01  | nextCaseNo                     | 7879  | 7891  |
| M01  | caseNoOf                       | 7894  | 7902  |
| M01  | leadNoOf                       | 7903  | 7909  |
| M01  | ensureCaseNos                  | 7911  | 7914  |
| M01  | filteredLeads                  | 8116  | 8123  |
| M01  | renderLeads                    | 8126  | 8193  |
| M01  | leadActionBtns                 | 8196  | 8208  |
| M01  | toggleLead                     | 8210  | 8213  |
| M01  | toggleAllLeads                 | 8214  | 8221  |
| M01  | clearLeadSelection             | 8224  | 8239  |
| M01  | pushOneLead                    | 8242  | 8251  |
| M01  | pushLeads                      | 8304  | 8321  |
| M01  | openLeadAudit                  | 8323  | 8373  |
| M01  | toggleLeadAuditFields          | 8377  | 8380  |
| M01  | submitLeadAudit                | 8382  | 8403  |
| M01  | openLeadConfirm                | 8406  | 8468  |
| M01  | toggleLeadConfirmFields        | 8471  | 8476  |
| M01  | submitLeadConfirm              | 8478  | 8511  |
| M01  | openLeadArchiveBatch           | 8518  | 8553  |
| M01  | toNotaryFromLead               | 8556  | 8584  |
| M01  | renderLeadStageNav             | 8587  | 8595  |
| M01  | gotoLeadStage                  | 8596  | 8600  |
| M01  | newLead                        | 8603  | 8614  |
| M01  | leadFormHTML                   | 8615  | 8707  |
| M01  | window.syncLeadPlatformOptions | 8710  | 8717  |
| M01  | window.syncEditLeadPlatforms   | 8721  | 8728  |
| M01  | window.addLeadLinkRow          | 8734  | 8756  |
| M01  | leadLinkSale                   | 8758  | 8761  |
| M01  | window.leadLinkRecalc          | 8763  | 8770  |
| M01  | window.openModal               | 8773  | 8782  |
| M01  | syncPartyOptions               | 8784  | 8791  |
| M01  | readLeadForm                   | 8792  | 8843  |
| M01  | shotFilesHTML                  | 8849  | 8853  |
| M01  | viewLead                       | 8856  | 8920  |
| M01  | window.viewLeadLinks           | 8924  | 8953  |
| M01  | window.editLeadLinks           | 8958  | 9000  |
| M01  | editLeadInfo                   | 9004  | 9055  |
| M01  | leadCSVTemplate                | 9061  | 9066  |
| M01  | downloadLeadTemplate           | 9067  | 9077  |
| M01  | importLeads                    | 9079  | 9135  |
| M01  | parseCSVLine                   | 9137  | 9153  |
| M01  | window.parseLeadCSV            | 9154  | 9198  |
| M08  | barChart                       | 9204  | 9212  |
| M08  | renderDashboard                | 9219  | 9242  |
| M08  | renderReports                  | 9245  | 9306  |
| M06  | billListOf                     | 9583  | 9583  |
| M06  | billDateOf                     | 9585  | 9585  |
| M06  | billFromCase                   | 9589  | 9589  |
| M06  | billSelectable                 | 9590  | 9590  |
| M06  | billCellHTML                   | 9595  | 9599  |
| M06  | billRowKey                     | 9602  | 9606  |
| M06  | ensureBillRowKeys              | 9608  | 9611  |
| M06  | billNoFor                      | 9617  | 9627  |
| M06  | syncBillNoField                | 9629  | 9634  |
| M00  | restoreExtras                  | 9678  | 9696  |
| M03  | renderNotary                   | 9701  | 9757  |
| M03  | caseProgressOf                 | 9763  | 9778  |
| M03  | toggleNotary                   | 9782  | 9785  |
| M03  | toggleAllNotary                | 9786  | 9793  |
| M03  | notaryActionBtns               | 9796  | 9809  |
| M03  | courierOptionsHTML             | 9814  | 9818  |
| M03  | courierSelectOptions           | 9822  | 9825  |
| M03  | courierRowHTML                 | 9829  | 9837  |
| M03  | courierRowsHTML                | 9838  | 9845  |
| M03  | addCourierRow                  | 9846  | 9852  |
| M03  | readCourierRows                | 9853  | 9860  |
| M03  | fillExpressNo                  | 9862  | 9910  |
| M03  | saveNotaryCollectDraft         | 9914  | 9931  |
| M03  | openNotaryInvestReport         | 9934  | 9983  |
| M03  | openPhotoCaseNo                | 9991  | 9995  |
| M03  | openPhotoCaseNoText            | 9997  | 10001 |
| M03  | openPhotoRecognize             | 10003 | 10010 |
| M03  | openPhotoPicked                | 10011 | 10020 |
| M03  | ocrRecognize                   | 10022 | 10031 |
| M03  | uploadOpenPhotos               | 10032 | 10083 |
| M03  | expressNoFromName              | 10089 | 10093 |
| M03  | groupOpenPhotoEntries          | 10095 | 10105 |
| M03  | matchOpenPhotoTarget           | 10107 | 10112 |
| M03  | applyOpenPhotoBatch            | 10115 | 10121 |
| M03  | uploadOpenPhotosBatch          | 10123 | 10145 |
| M03  | readOpenPhotoZip               | 10146 | 10173 |
| M03  | openOpenPhotoResult            | 10174 | 10189 |
| M03  | openNotaryAudit                | 10192 | 10225 |
| M03  | openNotaryConfirm              | 10228 | 10266 |
| M03  | openNotaryDoc                  | 10269 | 10369 |
| M03  | toEvidenceFromNotary           | 10372 | 10386 |
| M03  | toNotaryDocFromNotary          | 10389 | 10402 |
| M03  | openNotaryReturn               | 10405 | 10536 |
| M03  | toggleReturnBoxes              | 10538 | 10544 |
| M03  | openNotaryArchive              | 10550 | 10582 |
| M03  | openNotaryArchiveBatch         | 10588 | 10658 |
| M03  | toCaseFromNotary               | 10661 | 10678 |
| M03  | renderNotaryStageNav           | 10681 | 10702 |
| M03  | gotoNotaryStage                | 10703 | 10707 |
| M03  | notaryLeadOf                   | 10710 | 10722 |
| M03  | notaryArchived                 | 10727 | 10729 |
| M03  | notaryDetail                   | 10734 | 10815 |
| M03  | editNotary                     | 10820 | 10902 |
| M03  | notaryAdvance                  | 10905 | 10917 |
| M05  | renderEvidence                 | 10929 | 10991 |
| M05  | toggleEvSel                    | 10996 | 11000 |
| M05  | toggleAllEv                    | 11001 | 11010 |
| M05  | syncEvSelUI                    | 11013 | 11022 |
| M05  | exportSelectedEvidenceCSV      | 11025 | 11036 |
| M05  | bulkEvStatus                   | 11042 | 11088 |
| M05  | applyEvDateFilter              | 11091 | 11102 |
| M05  | clearEvDateFilter              | 11103 | 11110 |
| M05  | applyEvLawyerSearch            | 11114 | 11117 |
| M05  | evRowHTML                      | 11125 | 11136 |
| M05  | evRowStatusTouched             | 11138 | 11144 |
| M05  | syncEvRowStatus                | 11147 | 11161 |
| M05  | markEvRowManual                | 11163 | 11166 |
| M05  | evRowsHTML                     | 11167 | 11174 |
| M05  | addEvRow                       | 11175 | 11180 |
| M05  | removeEvRow                    | 11181 | 11187 |
| M05  | readEvRows                     | 11188 | 11201 |
| M05  | nextEvId                       | 11203 | 11213 |
| M05  | editEvidenceRow                | 11217 | 11365 |
| M07  | calMove                        | 11367 | 11372 |
| M07  | calToday                       | 11373 | 11377 |
| M07  | pad2                           | 11378 | 11378 |
| M07  | courtTipHTML                   | 11393 | 11403 |
| M07  | calCaseTipHTML                 | 11407 | 11425 |
| M07  | calCaseOf                      | 11429 | 11435 |
| M07  | lawyerSettleTipHTML            | 11447 | 11450 |
| M07  | ensureTipEl                    | 11452 | 11459 |
| M07  | showTip                        | 11460 | 11487 |
| M07  | hideTip                        | 11488 | 11488 |
| M07  | renderCalendar                 | 11504 | 11568 |
| M07  | calEventDetail                 | 11570 | 11574 |
| M06  | renderSettlementSplit          | 11579 | 11674 |
| M06  | settleProgScope                | 11680 | 11685 |
| M06  | settleProgSet                  | 11686 | 11690 |
| M06  | settleProgCaretId              | 11691 | 11693 |
| M06  | toggleSettleStageFilter        | 11694 | 11709 |
| M06  | closeSettleStageFilter         | 11710 | 11713 |
| M06  | renderSettleStageFilterPanel   | 11714 | 11726 |
| M06  | toggleSettleStageFilterKey     | 11727 | 11732 |
| M06  | clearSettleStageFilter         | 11733 | 11737 |
| M06  | syncSettleStageFilterUI        | 11738 | 11745 |
| M06  | settleCaseNoHTML               | 11756 | 11765 |
| M06  | toggleBillSel                  | 11769 | 11780 |
| M06  | toggleAllBillSel               | 11781 | 11799 |
| M06  | syncBillSelUI                  | 11800 | 11826 |
| M06  | renderSettleBills              | 11827 | 11846 |
| M06  | createBill                     | 11848 | 11895 |
| M06  | viewBill                       | 11896 | 11928 |
| M06  | revokeBill                     | 11935 | 11952 |
| M06  | doRevokeBill                   | 11953 | 11970 |
| M06  | switchSettleTab                | 11973 | 11978 |
| M06  | detailModal                    | 11986 | 11995 |
| M05  | evNotaryItemOf                 | 12000 | 12000 |
| M05  | evCaseOfKey                    | 12002 | 12007 |
| M05  | evDocOf                        | 12009 | 12014 |
| M05  | evShopOf                       | 12016 | 12020 |
| M05  | evBelongsToCase                | 12022 | 12029 |
| M05  | evCaseNoOf                     | 12031 | 12034 |
| M05  | viewCaseEvidence               | 12038 | 12093 |
| M06  | viewCustBill                   | 12097 | 12107 |
| M06  | viewLawBill                    | 12109 | 12117 |
| M09  | updateNavBadges                | 12120 | 12130 |
| M09  | exportData                     | 12136 | 12158 |
| M09  | importData                     | 12160 | 12177 |
| M09  | applyImport                    | 12179 | 12198 |
| M09  | copyFileHint                   | 12200 | 12210 |
| M09  | renderSettings                 | 12212 | 12229 |
| M09  | renderDocTemplates             | 12232 | 12251 |
| M09  | uploadDocTemplate              | 12252 | 12256 |
| M09  | onDocTemplateFile              | 12258 | 12281 |
| M09  | deleteDocTemplate              | 12282 | 12289 |
| M09  | previewDocTemplate             | 12290 | 12298 |
| M02  | castOf                         | 12308 | 12319 |
| M02  | logTime                        | 12322 | 12325 |
| M02  | plusDays                       | 12326 | 12332 |
| M02  | renderOverview                 | 12338 | 12388 |
| M02  | renderCaseFilesTab             | 12394 | 12416 |
| M02  | filesGridHTML                  | 12419 | 12541 |
| M02  | toggleFilesSel                 | 12544 | 12547 |
| M02  | toggleFilesSelAll              | 12549 | 12556 |
| M02  | syncFilesSelUI                 | 12558 | 12571 |
| M02  | caseFileDocContent             | 12574 | 12583 |
| M02  | downloadCaseFilesBatch         | 12586 | 12604 |
| M02  | renderCollapsePanels           | 12618 | 12673 |
| M02  | toggleCollapse                 | 12676 | 12684 |
| M02  | archInfoOf                     | 12690 | 12702 |
| M02  | renderCaseInfoPanel            | 12706 | 12743 |
| M02  | leadNotaryOf                   | 12747 | 12753 |
| M02  | renderLeadInfoPanel            | 12754 | 12767 |
| M02  | leadInfoBodyHTML               | 12768 | 12847 |
| M02  | renderFirstInstancePanel       | 12850 | 12921 |
| M02  | renderJudgmentPanel            | 12926 | 12934 |
| M02  | judgmentFirstBlockHTML         | 12937 | 12970 |
| M02  | judgmentSecondBlockHTML        | 12975 | 13010 |
| M02  | renderSecondInstancePanel      | 13013 | 13034 |
| M02  | renderExecPanel                | 13037 | 13063 |
| M02  | renderClosePanel               | 13066 | 13114 |
| M02  | renderSettleTab                | 13117 | 13149 |
| M02  | renderTabDots                  | 13161 | 13170 |
| M02  | viewFullLog                    | 13173 | 13185 |
| M02  | previewDraft                   | 13186 | 13192 |

## 全部顶层变量与配置

| 模块 | 标识符                 | 起行  | 止行  | 初始化语法类型           |
| ---- | ---------------------- | ----- | ----- | ------------------------ |
| M00  | CASE_TYPES             | 11    | 11    | ArrayLiteralExpression   |
| M00  | CASE_TYPE_TAG          | 12    | 15    | ObjectLiteralExpression  |
| M00  | OPERATORS              | 18    | 22    | ObjectLiteralExpression  |
| M00  | COURTS                 | 33    | 38    | ArrayLiteralExpression   |
| M00  | PLATFORMS              | 41    | 41    | ArrayLiteralExpression   |
| M00  | LEAD_PLATFORMS_ONLINE  | 49    | 49    | ArrayLiteralExpression   |
| M00  | LEAD_PLATFORMS_OFFLINE | 50    | 50    | ArrayLiteralExpression   |
| M00  | LEAD_PLATFORMS         | 52    | 52    | CallExpression           |
| M00  | INFRINGE_TYPES         | 59    | 60    | ArrayLiteralExpression   |
| M00  | SOURCES                | 63    | 63    | ArrayLiteralExpression   |
| M00  | CASES                  | 65    | 313   | ArrayLiteralExpression   |
| M00  | CUSTOMERS              | 318   | 383   | ArrayLiteralExpression   |
| M00  | CUSTOMER_DETAIL_CLIENT | 386   | 386   | StringLiteral            |
| M00  | $                      | 391   | 391   | ArrowFunction            |
| M00  | $$                     | 392   | 392   | ArrowFunction            |
| M00  | setTxt                 | 393   | 393   | ArrowFunction            |
| M00  | esc                    | 394   | 394   | ArrowFunction            |
| M00  | uid                    | 395   | 395   | ArrowFunction            |
| M00  | pad                    | 396   | 396   | ArrowFunction            |
| M00  | today                  | 397   | 397   | ArrowFunction            |
| M00  | stamp                  | 398   | 398   | ArrowFunction            |
| M00  | money                  | 399   | 399   | ArrowFunction            |
| M00  | numOf                  | 400   | 400   | ArrowFunction            |
| M00  | daysTo                 | 401   | 401   | ArrowFunction            |
| M00  | HEARING_SEED_ID        | 406   | 406   | StringLiteral            |
| M00  | HEARING_SEED_AT        | 407   | 407   | CallExpression           |
| M00  | TOAST_IC               | 410   | 410   | ObjectLiteralExpression  |
| M00  | MODAL_OK               | 425   | 425   | NullKeyword              |
| M00  | MODAL_NO_ESCAPE        | 426   | 426   | FalseKeyword             |
| M00  | REASON_LEGACY_RULES    | 509   | 521   | ArrayLiteralExpression   |
| M00  | MODAL_FILE_HOOKS       | 667   | 667   | ObjectLiteralExpression  |
| M00  | SK                     | 702   | 702   | StringLiteral            |
| M00  | SAVE_VER               | 703   | 703   | FirstLiteralToken        |
| M00  | DEF_SPLIT_RE           | 716   | 716   | RegularExpressionLiteral |
| M00  | SURNAMES               | 781   | 781   | ArrayLiteralExpression   |
| M00  | PERSON_ADDRS           | 782   | 786   | ArrayLiteralExpression   |
| M00  | BIZ_CITY               | 787   | 797   | ArrayLiteralExpression   |
| M00  | MOBILE_PREFIX          | 799   | 800   | ArrayLiteralExpression   |
| M00  | BIZ_TRADE              | 801   | 801   | ArrayLiteralExpression   |
| M00  | PRODUCT_POOL           | 803   | 836   | ArrayLiteralExpression   |
| M00  | GENERIC_PRODUCTS       | 837   | 841   | ArrayLiteralExpression   |
| M00  | STAGE_DONE_N           | 855   | 860   | ObjectLiteralExpression  |
| M00  | PRE_FILING             | 862   | 862   | ArrayLiteralExpression   |
| M00  | BLANK_WORDS            | 870   | 871   | ArrayLiteralExpression   |
| M00  | curMonth               | 880   | 880   | ArrowFunction            |
| M00  | sameMonth              | 881   | 881   | ArrowFunction            |
| M00  | CONTRACT_SEED_TEXT     | 1034  | 1048  | CallExpression           |
| M00  | CUST_DEFAULT_INVOICE   | 1052  | 1052  | StringLiteral            |
| M00  | CUST_DEFAULT_BANK      | 1053  | 1053  | StringLiteral            |
| M00  | CUST_DEFAULT_COOP_FROM | 1054  | 1054  | StringLiteral            |
| M00  | CUST_DEFAULT_COOP_TO   | 1055  | 1055  | StringLiteral            |
| M00  | CUST_SETTLE_OPTIONS    | 1056  | 1056  | ArrayLiteralExpression   |
| M00  | CUST_REGION_OPTIONS    | 1057  | 1057  | ArrayLiteralExpression   |
| M00  | CUST_STATUS_CLASS      | 1058  | 1058  | ObjectLiteralExpression  |
| M00  | STATE                  | 1102  | 1102  | CallExpression           |
| M00  | currentCaseId          | 1103  | 1103  | NullKeyword              |
| M00  | currentCustomerId      | 1104  | 1104  | NullKeyword              |
| M02  | LAWYER_BOOK            | 1197  | 1203  | ArrayLiteralExpression   |
| M02  | DEFAULT_CUST_FORMULA   | 1239  | 1239  | StringLiteral            |
| M02  | CUST_FORMULA_HINT      | 1240  | 1240  | StringLiteral            |
| M02  | LAW_SETTLE_MODES       | 1241  | 1241  | ArrayLiteralExpression   |
| M02  | PCT_OPTIONS            | 1242  | 1242  | CallExpression           |
| M02  | LAW_MODE_HINT          | 1243  | 1247  | ObjectLiteralExpression  |
| M02  | LAW_SETTLE_SEED        | 1248  | 1252  | ArrayLiteralExpression   |
| M02  | PREP_DOC_GROUP         | 1264  | 1264  | StringLiteral            |
| M02  | EXEC_DOC_GROUP         | 1265  | 1265  | StringLiteral            |
| M02  | STAGES                 | 1266  | 1382  | ArrayLiteralExpression   |
| M02  | groupStageKeys         | 1386  | 1386  | ArrowFunction            |
| M02  | prepDocStageKeys       | 1387  | 1387  | ArrowFunction            |
| M02  | isPrepDocFilter        | 1388  | 1388  | ArrowFunction            |
| M02  | stageOf                | 1390  | 1390  | ArrowFunction            |
| M02  | STAGE_KEYS             | 1391  | 1391  | CallExpression           |
| M02  | FILTER                 | 1394  | 1401  | ObjectLiteralExpression  |
| M02  | SELECTED               | 1402  | 1402  | NewExpression            |
| M02  | CUST_FILTER            | 1403  | 1403  | ObjectLiteralExpression  |
| M02  | multiDef               | 1505  | 1505  | ArrowFunction            |
| M02  | CASE_COL_DEFS          | 1556  | 1569  | ArrayLiteralExpression   |
| M02  | COL_PREFS              | 1570  | 1570  | ObjectLiteralExpression  |
| M03  | NOTARY_COL_DEFS        | 1612  | 1627  | ArrayLiteralExpression   |
| M03  | NOTARY_COL_PREFS       | 1628  | 1628  | ObjectLiteralExpression  |
| M00  | DOC_SVG_DOWN           | 1926  | 1926  | StringLiteral            |
| M00  | DOC_SVG_TRASH          | 1927  | 1927  | StringLiteral            |
| M00  | DOC_SVG_FILE           | 1928  | 1928  | StringLiteral            |
| M02  | CUR_STAGE_CASE_ID      | 2062  | 2062  | NullKeyword              |
| M02  | REFUND_STATUSES        | 2151  | 2151  | ArrayLiteralExpression   |
| M02  | SECOND_PROGRESSES      | 2379  | 2379  | ArrayLiteralExpression   |
| M02  | SECOND_UPDATE_PENDING  | 2391  | 2391  | ObjectLiteralExpression  |
| M02  | payProofUploadHTML     | 2517  | 2529  | ArrowFunction            |
| M02  | PAY_ONE_HINT           | 2558  | 2558  | StringLiteral            |
| M02  | DEFENDANT_KINDS        | 2817  | 2817  | ArrayLiteralExpression   |
| M00  | CRC_TABLE              | 2891  | 2899  | CallExpression           |
| M02  | PREP_DOC_ACTIONS       | 3600  | 3606  | ArrayLiteralExpression   |
| M02  | EXEC_DOC_ACTIONS       | 3607  | 3611  | ArrayLiteralExpression   |
| M02  | groupActionsOf         | 3612  | 3614  | ArrowFunction            |
| M02  | ARCHIVE_TYPES          | 3871  | 3871  | ArrayLiteralExpression   |
| M02  | LEAD_ARCHIVE_TYPES     | 3873  | 3873  | ArrayLiteralExpression   |
| M02  | NOTARY_ARCHIVE_TYPES   | 3875  | 3875  | ArrayLiteralExpression   |
| M02  | STAGE_DOC_RANK         | 4054  | 4059  | ObjectLiteralExpression  |
| M04  | FEE_TYPES              | 4252  | 4252  | ArrayLiteralExpression   |
| M04  | FEE_INCOME_TYPES       | 4253  | 4253  | ArrayLiteralExpression   |
| M04  | FEE_DIRS               | 4254  | 4254  | ArrayLiteralExpression   |
| M04  | FEE_STATUS             | 4255  | 4255  | ArrayLiteralExpression   |
| M04  | FEE_REFUND_STATUS      | 4257  | 4257  | ArrayLiteralExpression   |
| M04  | FEE_TO_EXP_STATUS      | 4268  | 4268  | ObjectLiteralExpression  |
| M04  | EXP_TO_FEE_STATUS      | 4270  | 4270  | ObjectLiteralExpression  |
| M04  | FEE_FILTER             | 4342  | 4342  | ObjectLiteralExpression  |
| M04  | FEE_SELECTED           | 4343  | 4343  | NewExpression            |
| M04  | FEE_COL_DEFS           | 4344  | 4355  | ArrayLiteralExpression   |
| M04  | FEE_COL_PREFS          | 4356  | 4356  | ObjectLiteralExpression  |
| M04  | EXP_STATUS             | 5018  | 5018  | ArrayLiteralExpression   |
| M04  | EXP_STATUS_CLS         | 5019  | 5019  | ObjectLiteralExpression  |
| M10  | ASSET_TYPES            | 6004  | 6004  | ArrayLiteralExpression   |
| M10  | ASSET_TCLS             | 6005  | 6006  | ObjectLiteralExpression  |
| M00  | VIEW_LABEL             | 6113  | 6114  | ObjectLiteralExpression  |
| M00  | NAV_OF                 | 6115  | 6115  | ObjectLiteralExpression  |
| M00  | SUBNAV_OF              | 6118  | 6122  | ObjectLiteralExpression  |
| M02  | MERGE_FIELDS           | 6316  | 6332  | ArrayLiteralExpression   |
| M02  | mergeFieldOf           | 6333  | 6333  | ArrowFunction            |
| M04  | EXP_FEE_TYPE_OPTIONS   | 6921  | 6921  | ArrayLiteralExpression   |
| M10  | BATCH_ASSET_ROWS       | 7247  | 7247  | ArrayLiteralExpression   |
| M03  | NOTARY_EXPORT_HEAD     | 7601  | 7602  | ArrayLiteralExpression   |
| M03  | notaryExportRows       | 7603  | 7607  | ArrowFunction            |
| M01  | LEAD_STAGES            | 7814  | 7819  | ArrayLiteralExpression   |
| M01  | LEAD_STAGE_KEYS        | 7820  | 7820  | CallExpression           |
| M01  | leadStage              | 7821  | 7821  | ArrowFunction            |
| M01  | PLAT_TAG               | 7824  | 7828  | ObjectLiteralExpression  |
| M01  | SOURCE_TAG             | 7829  | 7829  | ObjectLiteralExpression  |
| M01  | LEADS                  | 7919  | 8112  | ArrayLiteralExpression   |
| M01  | LEAD_FILTER            | 8113  | 8113  | ObjectLiteralExpression  |
| M01  | LEAD_SELECTED          | 8114  | 8114  | NewExpression            |
| M01  | LAWYER_TASKS           | 8254  | 8263  | ArrayLiteralExpression   |
| M01  | LAWYER_COLS            | 8264  | 8268  | ArrayLiteralExpression   |
| M01  | DEMO_NO                | 8273  | 8281  | CallExpression           |
| M06  | SETTLEMENTS            | 8285  | 8301  | ArrayLiteralExpression   |
| M06  | SETTLE_FILTER          | 8302  | 8302  | ObjectLiteralExpression  |
| M01  | _origOpenModal         | 8772  | 8772  | Identifier               |
| M01  | LEAD_CSV_HEADER        | 9060  | 9060  | ArrayLiteralExpression   |
| M08  | money0                 | 9201  | 9201  | ArrowFunction            |
| M08  | wan                    | 9202  | 9202  | ArrowFunction            |
| M08  | statCard               | 9213  | 9216  | ArrowFunction            |
| M03  | NOTARY_OFFICE_OPTIONS  | 9314  | 9317  | ArrayLiteralExpression   |
| M03  | NOTARY_FLOW            | 9320  | 9328  | ArrayLiteralExpression   |
| M03  | NOTARY_STAGE_KEYS      | 9329  | 9329  | CallExpression           |
| M03  | NOTARY_STAGE_CLS       | 9330  | 9333  | ObjectLiteralExpression  |
| M03  | notaryStage            | 9334  | 9334  | ArrowFunction            |
| M03  | NOTARY_FILTER          | 9336  | 9336  | ObjectLiteralExpression  |
| M03  | NOTARY_ITEMS           | 9337  | 9402  | ArrayLiteralExpression   |
| M03  | notaryTotal            | 9404  | 9404  | ArrowFunction            |
| M03  | openPhotoText          | 9407  | 9407  | ArrowFunction            |
| M03  | NOTARY_SHOPID          | 9423  | 9423  | ObjectLiteralExpression  |
| M03  | NOTARY_BUY             | 9424  | 9424  | ObjectLiteralExpression  |
| M03  | NOTARY_EXPRESS         | 9429  | 9435  | ObjectLiteralExpression  |
| M03  | NOTARY_INVEST_FEE      | 9445  | 9445  | ObjectLiteralExpression  |
| M05  | EVIDENCES              | 9449  | 9470  | ArrayLiteralExpression   |
| M05  | EV_FILTER              | 9474  | 9474  | ObjectLiteralExpression  |
| M05  | EV_SELECTED            | 9477  | 9477  | NewExpression            |
| M05  | NOTARY_DOCS            | 9479  | 9487  | ArrayLiteralExpression   |
| M07  | CAL_EVENTS             | 9490  | 9507  | ArrayLiteralExpression   |
| M07  | EV_TYPE_CLS            | 9508  | 9508  | ObjectLiteralExpression  |
| M07  | EV_TYPE_LABEL          | 9509  | 9509  | ObjectLiteralExpression  |
| M07  | CAL                    | 9510  | 9510  | ObjectLiteralExpression  |
| M06  | CUST_BILLS             | 9515  | 9531  | ArrayLiteralExpression   |
| M06  | CUST_BILL_FILTER       | 9532  | 9532  | ObjectLiteralExpression  |
| M06  | LAW_BILLS              | 9534  | 9548  | ArrayLiteralExpression   |
| M06  | LAW_BILL_FILTER        | 9549  | 9549  | ObjectLiteralExpression  |
| M06  | BILLS                  | 9560  | 9577  | ArrayLiteralExpression   |
| M06  | BILL_SEL               | 9581  | 9581  | ObjectLiteralExpression  |
| M06  | BILL_SIDE_LABEL        | 9582  | 9582  | ObjectLiteralExpression  |
| M06  | BILL_ROW_SEQ           | 9600  | 9600  | FirstLiteralToken        |
| M09  | BUILTIN_DRAFT_TEMPLATE | 9638  | 9657  | FirstTemplateToken       |
| M09  | DOC_TEMPLATES          | 9659  | 9662  | ArrayLiteralExpression   |
| M00  | DEMO_DEFAULTS          | 9665  | 9675  | ObjectLiteralExpression  |
| M03  | NOTARY_SELECTED        | 9781  | 9781  | NewExpression            |
| M03  | COURIER_COMPANIES      | 9813  | 9813  | ArrayLiteralExpression   |
| M03  | COURIER_GRID           | 9828  | 9828  | StringLiteral            |
| M03  | OPEN_PHOTO_FILES       | 9989  | 9989  | ArrayLiteralExpression   |
| M03  | NOTARY_AUDIT_CLS       | 10818 | 10818 | ObjectLiteralExpression  |
| M05  | EV_STATUS_CLS          | 10923 | 10923 | ObjectLiteralExpression  |
| M05  | DOC_STATUS_CLS         | 10924 | 10924 | ObjectLiteralExpression  |
| M05  | EV_STATUSES            | 10926 | 10926 | ArrayLiteralExpression   |
| M05  | DOC_STATUSES           | 10927 | 10927 | ArrayLiteralExpression   |
| M05  | EV_GRID                | 11124 | 11124 | StringLiteral            |
| M07  | TIP_STORE              | 11383 | 11383 | NewExpression            |
| M07  | tipSeq                 | 11384 | 11384 | FirstLiteralToken        |
| M07  | COURT_TIP_FIELDS       | 11385 | 11392 | ArrayLiteralExpression   |
| M07  | regTip                 | 11436 | 11443 | ArrowFunction            |
| M07  | TIP_EL                 | 11451 | 11451 | NullKeyword              |
| M02  | fieldRow               | 12333 | 12335 | ArrowFunction            |
| M02  | FILES_ITEMS            | 12391 | 12391 | ArrayLiteralExpression   |
| M02  | FILES_SEL              | 12392 | 12392 | NewExpression            |
| M02  | TAB_LOG                | 13157 | 13160 | ObjectLiteralExpression  |
