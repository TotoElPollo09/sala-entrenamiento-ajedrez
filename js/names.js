// Nombres en español de los temas de puzzles de Lichess.
const TEMAS = {
  fork: 'Horquilla', pin: 'Clavada', skewer: 'Ensartada', mate: 'Mate', mateIn1: 'Mate en 1', mateIn2: 'Mate en 2', mateIn3: 'Mate en 3',
  mateIn4: 'Mate en 4', mateIn5: 'Mate en 5+', endgame: 'Final', middlegame: 'Medio juego', opening: 'Apertura', deflection: 'Desviación',
  attraction: 'Atracción', discoveredAttack: 'Ataque a la descubierta', discoveredCheck: 'Jaque a la descubierta', sacrifice: 'Sacrificio',
  hangingPiece: 'Pieza colgada', trappedPiece: 'Pieza atrapada', kingsideAttack: 'Ataque al flanco de rey', queensideAttack: 'Ataque al flanco de dama',
  defensiveMove: 'Jugada defensiva', quietMove: 'Jugada tranquila', advancedPawn: 'Peón avanzado', promotion: 'Coronación',
  underPromotion: 'Subpromoción', rookEndgame: 'Final de torres', pawnEndgame: 'Final de peones', queenEndgame: 'Final de damas',
  bishopEndgame: 'Final de alfiles', knightEndgame: 'Final de caballos', queenRookEndgame: 'Final de dama y torre',
  backRankMate: 'Mate del pasillo', clearance: 'Despeje', intermezzo: 'Jugada intermedia', exposedKing: 'Rey expuesto',
  capturingDefender: 'Captura del defensor', interference: 'Interferencia', xRayAttack: 'Rayos X', zugzwang: 'Zugzwang',
  doubleCheck: 'Jaque doble', crushing: 'Ventaja decisiva', advantage: 'Ventaja', equality: 'Igualdad', smotheredMate: 'Mate de la coz',
  attackingF2F7: 'Ataque a f2/f7', castling: 'Enroque', enPassant: 'Al paso', hookMate: 'Mate del gancho', anastasiaMate: 'Mate de Anastasia',
  arabianMate: 'Mate árabe', bodenMate: 'Mate de Boden', dovetailMate: 'Mate de la cola de paloma', doubleBishopMate: 'Mate de los dos alfiles',
  collinearMove: 'Jugada en línea', pillsburysMate: 'Mate de Pillsbury', operaMate: 'Mate de la ópera', epauletteMate: 'Mate de las charreteras',
  morphysMate: 'Mate de Morphy',
}
export const temaName = (t) => TEMAS[t] || t
