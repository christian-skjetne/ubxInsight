# UBX-SEC-OSNMA

# DATA0
Information related to the execution of OSNMA protocol. Reports periodically the total number of satellites transmitting OSNMA data, the latest authenticated service status and configuration and the authentication results per satellite.

## version
Message version (0x01 for this version)

## nmaHeader
NMA header (status of the OSNMA service: NMA status, chain in force and CPKS)

## headerAuthStatus
Indicates if the NMA header has been authenticated.

## nmaStatus
Status of OSNMA service (as indicated by the Galileo system)

- 0: Service status not authenticated yet
- 1: OSNMA service in test
- 2: OSNMA service operational
- 3: OSNMA service invalid, service not usable

## chainInForce
Id of the TESLA chain in force

## CPKS
TESLA chain and public key status

- 0: Data is not applicable
- 1: Nominal
- 2: End of Chain (EOC), new DSM-KROOT is being transmitted
- 3: Chain revoked (CREV), a chain is or has been revoked
- 4: New public key (NPK), the public key in force is being renewed
- 5: Public key revocation (PKREV), the public key is or has been revoked

## osnmaMonitoring
Monitoring information on OSNMA service as observed by the receiver

## osnmaEnabled
Flag that indicates whether OSNMA execution is enabled in the receiver

## numberSVs
Number of SVs from which OSNMA data is being collected

## nmaHeaderUpdate
New unauthenticated NMA header (NMA status, chain in force and CPKS) observed in the signal. Changes are pending on authentication. The authentication of the MAC and TESLA keys is discontinued until the new header has been authenticated

- 0: Last observed NMA header is the same as the last authenticated header
- 1: New observed NMA header pending on authentication: Update still indicates a healthy service
- 2: New observed NMA header pending on authentication: Update indicates a problem in the service provision

## timSyncReq
Information related to OSNMA Time Synchronization requirement status

## timSyncEnabled
Flag that indicates if OSNMA must be executed applying the Time Synchronization requirement

## timSyncStatus
Indicates if the time synchronization check has been applied.

- 0: Time synchronization is not performed. Default to outside authentication epochs or when time synchronization is not requested
- 1: Time synchronization could not be performed, trusted time is not available
- 2: Time synchronization could not be performed, the trusted time is not accurate enough
- 3: Time synchronization check passed
- 4: Time synchronization check failed, replay attack

## timSyncReqDiff
Time difference from the Time Synchronization requirement.

The time difference between the trusted input time and the decoded GSTpropagated to the current local time from the subframe that contains the TESLA key to be authenticated. Note that the time synchronization status must pass or fail (timSyncReq = 3/4). Otherwise, the the time difference cannot be computed

## reserved0
dsmAuthentication
Information related to the DSM authentication

## dsmAuthenticationStatus
Indicates if the authentication of a Digital Signature Message has been performed

- 0: No DSM authentication
- 1: DSM-KROOT authenticated, new status and configuration accepted
- 2: DSM-PKR authenticated, new public key accepted
- 3: OSNMA Alert message: All cryptographic data is dropped
- 4: DSM-KROOT authentication failed, new status and configuration is not accepted
- 5: DSM-PKR authentication failed, new public key is not accepted
- 6: Authentication not performed: DSM coded with unknown public key
- 7: Authentication not performed: Public key decompression failed
- 8: Received configuration is not supported
- 9: Authentication of new public key cannot be performed. Missing next Merkle tree root

## hashFunction
Last authenticated hash function that must be used

## macFunction
Last authenticated MAC function that must be used

## pubKeyId
Last authenticated public key Id that must be used in ECDSA verification

## macLookupTable
Last authenticated MAC Lookup table index

## keySize
Last authenticated TESLA key size index

## macSize
Last authenticated MAC size index

## fromNVS
Last authenticated configuration comes from NVS

## teslaKey
Information related to the TESLA key authentication

## teslaKeyAuthStatus
Indicates if the authentication of an element of the TESLA key has been performed and the result thereof

- 0: No TESLA key authentication performed
- 1: TESLA key successfully authenticated against the root key
- 2: TESLA key authentication against the root key has failed
- 3: TESLA key authentication on-going: intermediate authentication step

## wnSf
The GST week number of the subframe in which the public key has been transmitted

## towSf
Seconds of week of the GST of the subframe in which the public key has been transmitted divided by 30s (subframe length)

## chainId
Chain Id of the TESLA key that has been authenticated

## generalAndTiming
Information related to the overall authentication process: Timing parameters and summary of data authenticated

## authSVs
Total number of SVs for which orbit/clocks data authentication has been performed (ADKD types 0 or 12)

## authNumTim
Total number of timing parameters authentications (typically one per SV sending MAC ADKD type 4)

## timingAuthResult
Indicates if the authentication of the timing parameters (GST-UTC and GST-GPS) has been performed and the result

- 0: No timing parameters authentication performed
- 1: Timing parameters successfully authenticated
- 2: Timing parameters authentication failed

## macAdkdType
Indicates if the receiver processes fast (1 subframe delay) or slow (10 subframes delay) MACs

- 0: Fast MACs (ADKD type 0)
- 1: Slow MACs (ADKD type 12)

## pubKeySrc
Origin of the public key

- 0: Factory default
- 1: From satellites
- 2: From aided message

## bitfield1
bitfield:

## IODE
Issue of data, authenticated ephemeris

## authNum
Number of times that the same block of navigation data has been authenticated in last execution

## authStatus
Indicates the authentication result for current SV's orbits, clocks, flags group delays and ionospheric delay data:

- 0: Navigation data successfully authenticated
- 1: Navigation data authentication failed

## svId
Satellite identifier whose data gets authenticated (see Satellite Numbering)

## reserved1

# DATA1
Information related to the execution of OSNMA protocol. Reports periodically the total number of satellites transmitting OSNMA data, the latest authenticated service status and configuration and the authentication results per satellite.

## version
Message version (0x02 for this version)

## nmaHeader
NMA header (status of the OSNMA service: NMA status, chain in force and CPKS)

## headerAuthStatus
Indicates if the NMA header has been authenticated.

## nmaStatus
Status of OSNMA service (as indicated by the Galileo system)

- 0: Service status not authenticated yet
- 1: OSNMA service in test
- 2: OSNMA service operational
- 3: OSNMA service invalid, service not usable

## chainInForce
Id of the TESLA chain in force

## CPKS
TESLA chain and public key status

- 0: Data is not applicable
- 1: Nominal
- 2: End of Chain (EOC), new DSM-KROOT is being transmitted
- 3: Chain revoked (CREV), a chain is or has been revoked
- 4: New public key (NPK), the public key in force is being renewed
- 5: Public key revocation (PKREV), the public key is or has been revoked
- 6: New Merkle tree (NMT), the Merkle tree is being renewed
- 7: Alert message (AM), OSNMA cryptographic data has been dropped. Connect to the GSC OSNMA server

## osnmaMonitoring
Monitoring information on OSNMA service as observed by the receiver

## osnmaEnabled
Flag that indicates whether OSNMA execution is enabled in the receiver

## numberSVs
Number of SVs from which OSNMA data is being collected

## nmaHeaderUpdate
New unauthenticated NMA header (NMA status, chain in force and CPKS) observed in the signal. Changes are pending on authentication. The authentication of the MAC and TESLA keys is discontinued until the new header has been authenticated

- 0: Last observed NMA header is the same as the last authenticated header
- 1: New observed NMA header pending on authentication: Update still indicates a healthy service
- 2: New observed NMA header pending on authentication: Update indicates a problem in the service provision

## timSyncReq
Information related to OSNMA Time Synchronization requirement status

## timSyncEnabled
Flag that indicates if OSNMA must be executed applying the Time Synchronization requirement

## timSyncStatus
Indicates if the time synchronization check has been applied.

- 0: Time synchronization is not performed. Default to outside authentication epochs or when time synchronization is not requested
- 1: Time synchronization could not be performed, trusted time is not available
- 2: Time synchronization could not be performed, the trusted time is not accurate enough
- 3: Time synchronization check passed
- 4: Time synchronization check failed, replay attack

## timSyncReqDiff
Time difference from the Time Synchronization requirement.

The time difference between the trusted input time and the decoded GSTpropagated to the current local time from the subframe that contains the TESLA key to be authenticated. Note that the time synchronization status must pass or fail (timSyncReq = 3/4). Otherwise, the the time difference cannot be computed

## reserved0
dsmAuthentication
Information related to the DSM authentication

## dsmAuthenticationStatus
Indicates if the authentication of a Digital Signature Message has been performed

- 0: No DSM authentication
- 1: DSM-KROOT authenticated, new status and configuration accepted
- 2: DSM-PKR authenticated, new public key accepted
- 3: OSNMA Alert message: All cryptographic data is dropped. Connect to GSC OSNMA server
- 4: DSM-KROOT authentication failed, new status and configuration is not accepted
- 5: DSM-PKR authentication failed, new public key is not accepted
- 6: Authentication not performed: DSM coded with unknown public key
- 7: Authentication not performed: Public key decompression failed
- 8: Authentication successful but new configuration is not supported
- 9: Authentication of a new public key during a NMT event cannot be performed. Missing future Merkle tree root

## hashFunction
Last authenticated hash function that must be used

## macFunction
Last authenticated MAC function that must be used

## pubKeyId
Last authenticated public key Id that must be used in ECDSA verification

## macLookupTable
Last authenticated MAC Lookup table index

## keySize
Last authenticated TESLA key size index

## macSize
Last authenticated MAC size index

## fromNVS
Last authenticated configuration comes from NVS

## teslaKey
Information related to the TESLA key authentication

## teslaKeyAuthStatus
Indicates if the authentication of an element of the TESLA key has been performed and the result thereof

- 0: No TESLA key authentication performed
- 1: TESLA key successfully authenticated against the root key
- 2: TESLA key authentication against the root key has failed
- 3: TESLA key authentication on-going: Intermediate authentication step
- 4: TESLA key authentication is not performed: Key to authenticate is in the past. Potential replayed signals or simulation.

## wnSf
The GST week number of the subframe in which the public key has been transmitted

## towSf
Seconds of week of the GST of the subframe in which the public key has been transmitted divided by 30s (subframe length)

## chainId
Chain Id of the TESLA key that has been authenticated

## generalAndTiming
Information related to the overall authentication process: Timing parameters and summary of data authenticated

## authSVs
Total number of SVs for which orbit/clocks data authentication has been performed (ADKD types 0 or 12)

## authNumTim
Total number of timing parameters authentications (typically one per SV sending MAC ADKD type 4)

## timingAuthResult
Indicates if the authentication of the timing parameters (GST-UTC and GST-GPS) has been performed and the result

- 0: No timing parameters authentication performed
- 1: Timing parameters successfully authenticated
- 2: Timing parameters authentication failed

## macAdkdType
Indicates if the receiver processes fast (1 subframe delay) or slow (10 subframes delay) MACs

- 0: Fast MACs (ADKD type 0)
- 1: Slow MACs (ADKD type 12)

## pubKeySrc
Origin of the public key

- 0: Factory default
- 1: From satellites
- 2: From aided message
- 3: From NVS

## merkleRootSrc
Origin of the Merkle tree root

- 0: Factory default
- 2: From aided message
- 3: From NVS

## merkleRootVal
Validity of the Merkle tree root currently applicable

- 0: Merkle tree root is invalid
- 1: Merkle tree root is valid

## futureMerkleRootSrc
Origin of the future Merkle tree root

- 0: Factory default
- 2: From aided message
- 3: From NVS

## futureMerkleRootVal
Validity of the future Merkle tree root

- 0: Future Merkle tree root is invalid or unknown
- 1: Future Merkle tree root is valid

## pubKeyVal
Validity of the public key

- 0: Public key is invalid or unknown
- 1: Public key is valid

## futurePubKeyVal
Validity of the future public key

- 0: Future public key is invalid or unknown
- 1: Future public key is valid

## futurePubKeySrc
Origin of the future public key

- 0: Factory default
- 1: From satellites
- 3: From NVS

## futurePubKeyId
Last authenticated public key Id that will be used in ECDSA verification after the next key update

## bitfield1
bitfield:

## IODE
Issue of data, authenticated ephemeris

## authNum
Number of times that the same block of navigation data has been authenticated in last execution

## authStatus
Indicates the authentication result for current SV's orbits, clocks, flags group delays and ionospheric delay data:

- 0: Navigation data successfully authenticated
- 1: Navigation data authentication failed

## svId
Satellite identifier whose data gets authenticated (see Satellite Numbering)

## reserved1

# DATA2
Information related to the execution of OSNMA protocol. Reports periodically the total number of satellites transmitting OSNMA data, the latest authenticated service status and configuration and the authentication results per satellite.

## version
Message version (0x03 for this version)

## nmaHeader
NMA header (status of the OSNMA service: NMA status, chain in force and CPKS)

## headerAuthStatus
Indicates if the NMA header has been authenticated.

## nmaStatus
Status of OSNMA service (as indicated by the Galileo system)

- 0: Service status not authenticated yet
- 1: OSNMA service in test
- 2: OSNMA service operational
- 3: OSNMA service invalid, service not usable

## chainInForce
Id of the TESLA chain in force

## CPKS
TESLA chain and public key status

- 0: Data is not applicable
- 1: Nominal
- 2: End of Chain (EOC), new DSM-KROOT is being transmitted
- 3: Chain revoked (CREV), a chain is or has been revoked
- 4: New public key (NPK), the public key in force is being renewed
- 5: Public key revocation (PKREV), the public key is or has been revoked
- 6: New Merkle tree (NMT), the Merkle tree is being renewed
- 7: Alert message (AM), OSNMA cryptographic data has been dropped. Connect to the GSC OSNMA server

## osnmaMonitoring
Monitoring information on OSNMA service as observed by the receiver

## osnmaEnabled
Flag that indicates whether OSNMA execution is enabled in the receiver

## numberSVs
Number of SVs from which OSNMA data is being collected

## nmaHeaderUpdate
New unauthenticated NMA header (NMA status, chain in force and CPKS) observed in the signal. Changes are pending on authentication. The authentication of the MAC and TESLA keys is discontinued until the new header has been authenticated

- 0: Last observed NMA header is the same as the last authenticated header
- 1: New observed NMA header pending on authentication: Update still indicates a healthy service
- 2: New observed NMA header pending on authentication: Update indicates a problem in the service provision

## noData
If true, OSNMA data is not available for the time defined in CFG-SEC-SPOOFDET_OSNMA_DENIAL_TIME .

## wrongData
If true, OSNMA data is inconsistent.

## wrongFlxMac
If true, flexible slots authentication have failed (FLX)

## wrongMaclt
If true, the tags sequence do not follow the MAC look-up table (MACLT).

## timSyncReq
Information related to OSNMA Time Synchronization requirement status

## timSyncEnabled
Flag that indicates if OSNMA must be executed applying the Time Synchronization requirement

## timSyncStatus
Indicates if the time synchronization check has been applied.

- 0: Time synchronization is not performed. Default to outside authentication epochs or when time synchronization is not requested
- 1: Time synchronization could not be performed, trusted time is not available
- 2: Time synchronization could not be performed, the trusted time is not accurate enough
- 3: Time synchronization check passed
- 4: Time synchronization check failed, replay attack

## reserved0

## timSyncReqDiff
Time difference from the Time Synchronization requirement.

The time difference between the trusted input time and the decoded GSTpropagated to the current local time from the subframe that contains the TESLA key to be authenticated. Note that the time synchronization status must pass or fail (timSyncReq = 3/4). Otherwise, the the time difference cannot be computed

## reserved1
dsmAuthentication
Information related to the DSM authentication

## dsmAuthenticationStatus
Indicates if the authentication of a Digital Signature Message has been performed

- 0: No DSM authentication
- 1: DSM-KROOT authenticated, new status and configuration accepted
- 2: DSM-PKR authenticated, new public key accepted
- 3: OSNMA Alert message: All cryptographic data is dropped. Connect to GSC OSNMA server
- 4: DSM-KROOT authentication failed, new status and configuration is not accepted
- 5: DSM-PKR authentication failed, new public key is not accepted
- 6: Authentication not performed: DSM coded with unknown public key
- 7: Authentication not performed: Public key decompression failed
- 8: Authentication successful but new configuration is not supported
- 9: Authentication of a new public key during a NMT event cannot be performed. Missing future Merkle tree root

## hashFunction
Last authenticated hash function that must be used

## macFunction
Last authenticated MAC function that must be used

## pubKeyId
Last authenticated public key Id that must be used in ECDSA verification

## macLookupTable
Last authenticated MAC Lookup table index

## keySize
Last authenticated TESLA key size index

## macSize
Last authenticated MAC size index. Add an offset of 5 to obtain the index as per Table 11 of OSNMA SIS ICD, Issue 1.1

## fromNVS
Last authenticated configuration comes from NVS

## teslaKey
Information related to the TESLA key authentication

## teslaKeyAuthStatus
Indicates if the authentication of an element of the TESLA key has been performed and the result thereof

- 0: No TESLA key authentication performed
- 1: TESLA key successfully authenticated against the root key
- 2: TESLA key authentication against the root key has failed
- 3: TESLA key authentication on-going: Intermediate authentication step
- 4: TESLA key authentication is not performed: Key to authenticate is in the past. Potential replayed signals or simulation.
- 5: TESLA key authentication is not performed: The root key is too old

## wnSf
The GST week number of subframe in which the public key has been transmitted

## towSf
Seconds of week of the GST of the subframe in which the public key has been transmitted divided by 30s (subframe length)

## chainId
Chain Id of the TESLA key that has been authenticated

## generalAndTiming
Information related to the overall authentication process: Timing parameters and summary of data authenticated

## authSVs
Total number of SVs for which orbit/clocks data authentication has been performed (ADKD types 0 or 12)

## authNumTim
Total number of timing parameters authentications (typically one per SV sending MAC ADKD type 4)

## timingAuthResult
Indicates if the authentication of the timing parameters (GST-UTC and GST-GPS) has been performed and the result

- 0: No timing parameters authentication performed
- 1: Timing parameters successfully authenticated
- 2: Timing parameters authentication failed

## macAdkdType
Indicates if the receiver processes fast (1 subframe delay) or slow (10 subframes delay) MACs

- 0: Fast MACs (ADKD type 0)
- 1: Slow MACs (ADKD type 12)

## pubKeySrc
Origin of the public key

- 0: Factory default
- 1: From satellites
- 2: From aided message
- 3: From NVS

## merkleRootSrc
Origin of the Merkle tree root

- 0: Factory default
- 2: From aided message
- 3: From NVS

## merkleRootVal
Validity of the Merkle tree root currently applicable

- 0: Merkle tree root is invalid
- 1: Merkle tree root is valid

## futureMerkleRootSrc
Origin of the future Merkle tree root

- 0: Factory default
- 2: From aided message
- 3: From NVS

## futureMerkleRootVal
Validity of the future Merkle tree root

- 0: Future Merkle tree root is invalid or unknown
- 1: Future Merkle tree root is valid

## pubKeyVal
Validity of the public key

- 0: Public key is invalid or unknown
- 1: Public key is valid

## futurePubKeyVal
Validity of the future public key

- 0: Future public key is invalid or unknown
- 1: Future public key is valid

## futurePubKeySrc
Origin of the future public key

- 0: Factory default
- 1: From satellites
- 3: From NVS

## futurePubKeyId
Last authenticated public key Id that will be used in ECDSA verification after the next key update

## bitfield1
bitfield:

## IODE
Issue of data, authenticated ephemeris

## authNum
Number of times that the same block of navigation data has been authenticated in last execution

## authStatus
Indicates the authentication result for current SV's orbits, clocks, flags, group delays and ionospheric delay data:

- 0: Navigation data authentication failed
- 1: Navigation data successfully authenticated

## svId
Satellite identifier whose data gets authenticated (see Satellite Numbering)

## reserved2