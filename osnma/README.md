# OSNMA trust material

Place the operator-trusted Galileo OSNMA public-key package (XML and certificate),
its matching CRL, and the applicable Merkle-tree package (XML, signature, and
certificate) in this directory, preserving original filenames. Do not add
private keys, account credentials, or other secrets.

This project uses an operator-pinned public-key certificate as its trust input;
validating its X.509 issuer chain is intentionally not required. Check for key
updates and revocations through official Galileo Service Centre and EUSPA
channels. The OSNMA tab can send the public key and Merkle root to a connected
receiver after checking that the package signature and key metadata match. The
app does not validate the X.509 issuer chain or independently authenticate
navigation data. By default, it sends no trusted time and disables the receiver's
strict OSNMA time-synchronization requirement, reducing replay protection. An
explicit opt-in can send the computer's UTC time with a user-specified uncertainty;
use this only when the computer clock is independently synchronized. The app does
not verify the computer clock's synchronization or accuracy.

Official information: https://www.gsc-europa.eu/galileo/services/galileo-open-service-navigation-message-authentication-osnma