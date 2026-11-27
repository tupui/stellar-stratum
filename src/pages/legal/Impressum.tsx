import { LegalHeader, Row as Pair, Rows } from '@/components/legal';
import { LEGAL_EMAIL, TEXT_LINK } from '@/lib/legal';

/** The notice Austrian law asks of the operator, in its own language. */
const Impressum = () => (
  <div lang="de" className="space-y-6">
    <LegalHeader title="Impressum">
      Angaben gemäß §5 ECG, §14 UGB und §25 MedienG.
    </LegalHeader>
    <Rows>
      <Pair label="Medieninhaber und Diensteanbieter">
        Consulting Manao GmbH
        <br />
        Köppling 35
        <br />
        8565 Söding-Sankt Johann
        <br />
        Österreich
      </Pair>
      <Pair label="Kontakt">
        <a href={`mailto:${LEGAL_EMAIL}`} className={TEXT_LINK}>
          {LEGAL_EMAIL}
        </a>
        <br />
        <a href="https://consulting-manao.com" target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
          consulting-manao.com
        </a>
      </Pair>
      <Pair label="Firmenbuch">FN 571029z, Landesgericht für ZRS Graz</Pair>
      <Pair label="UID-Nummer">ATU77780135</Pair>
      <Pair label="Unternehmensgegenstand">
        Dienstleistungen in der automatischen Datenverarbeitung und Informationstechnik
      </Pair>
      <Pair label="Kammer">Wirtschaftskammer Steiermark</Pair>
      <Pair label="Gewerberecht">
        Gewerbeordnung,{' '}
        <a href="https://www.ris.bka.gv.at" target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
          ris.bka.gv.at
        </a>
      </Pair>
      <Pair label="Aufsichtsbehörde">Bezirkshauptmannschaft Voitsberg</Pair>
      <Pair label="Grundlegende Richtung">
        Eine Anwendung zur Verwaltung von Multisig-Konten im Stellar-Netzwerk.
      </Pair>
    </Rows>
  </div>
);

export default Impressum;
