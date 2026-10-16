package tournament

import "strings"

func (s *State) category(id string) (*Category, error) {
	for i := range s.Categories {
		if s.Categories[i].ID == id {
			return &s.Categories[i], nil
		}
	}
	return nil, ErrNotFound
}

// Category returns a copy of the category.
func (s *State) Category(id string) (Category, error) {
	c, err := s.category(id)
	if err != nil {
		return Category{}, err
	}
	return *c, nil
}

func (s *State) locked(categoryID string) bool {
	b := s.Brackets[categoryID]
	return b != nil && b.Locked
}

// onRing reports whether one of the category's matches is on the ring: its
// result must still find the match where it was when the fight started.
func (s *State) onRing(categoryID string) bool {
	if b := s.Brackets[categoryID]; b != nil {
		for _, m := range b.Matches {
			if m.Status == Active {
				return true
			}
		}
	}
	return false
}

// SetInfo sets the tournament name and date printed on the bracket PDF.
func (s *State) SetInfo(name, date string) {
	s.Name, s.Date = strings.TrimSpace(name), strings.TrimSpace(date)
}

// AddCategory adds c; the caller chooses its ID.
func (s *State) AddCategory(c Category) error {
	c.Name = strings.TrimSpace(c.Name)
	if c.ID == "" || c.Name == "" {
		return ErrInvalid
	}
	c.Format = c.Format.Normalized()
	c.Fighters = []Fighter{}
	s.Categories = append(s.Categories, c)
	return nil
}

// EditCategory changes the descriptive fields and the format; fighters stay.
func (s *State) EditCategory(c Category) error {
	cur, err := s.category(c.ID)
	if err != nil {
		return err
	}
	cur.Name, cur.Gender, cur.Sex, cur.Discipline = c.Name, c.Gender, c.Sex, c.Discipline
	cur.Format = c.Format.Normalized()
	return nil
}

// DeleteCategory removes a category and its bracket. Refused while one of its
// matches is on the ring.
func (s *State) DeleteCategory(id string) error {
	if s.onRing(id) {
		return ErrMatchOnRing
	}
	for i := range s.Categories {
		if s.Categories[i].ID == id {
			s.Categories = append(s.Categories[:i], s.Categories[i+1:]...)
			delete(s.Brackets, id)
			return nil
		}
	}
	return ErrNotFound
}

// AddFighter adds f (the caller chooses its ID). Refused once the bracket is locked (§8).
func (s *State) AddFighter(categoryID string, f Fighter) error {
	c, err := s.category(categoryID)
	if err != nil {
		return err
	}
	if s.locked(categoryID) {
		return ErrLocked
	}
	f.Name = strings.TrimSpace(f.Name)
	if f.ID == "" || f.Name == "" {
		return ErrInvalid
	}
	c.Fighters = append(c.Fighters, f)
	return nil
}

// EditFighter changes a fighter's details; the bracket shows the new name.
func (s *State) EditFighter(categoryID string, f Fighter) error {
	c, err := s.category(categoryID)
	if err != nil {
		return err
	}
	for i := range c.Fighters {
		if c.Fighters[i].ID == f.ID {
			c.Fighters[i] = f
			if b := s.Brackets[categoryID]; b != nil {
				b.rename(f.ID, f.Name)
			}
			return nil
		}
	}
	return ErrNotFound
}

// DeleteFighter removes a fighter. Refused once the bracket is locked (§8).
func (s *State) DeleteFighter(categoryID, fighterID string) error {
	c, err := s.category(categoryID)
	if err != nil {
		return err
	}
	if s.locked(categoryID) {
		return ErrLocked
	}
	for i := range c.Fighters {
		if c.Fighters[i].ID == fighterID {
			c.Fighters = append(c.Fighters[:i], c.Fighters[i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func (b *Bracket) rename(fighterID, name string) {
	for i := range b.Matches {
		m := &b.Matches[i]
		if m.FighterRedID == fighterID {
			m.FighterRedName = name
		}
		if m.FighterBlueID == fighterID {
			m.FighterBlueName = name
		}
	}
}
